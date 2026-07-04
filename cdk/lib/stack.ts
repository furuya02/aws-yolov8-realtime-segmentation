import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import * as path from 'path';

export class YoloSegStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const suffix = this.node.tryGetContext('bucket_suffix') ?? this.account;

    // Cognito: ユーザー認証（管理者のみユーザー作成、メールサインイン）
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `yolov8-seg-userpool-${suffix}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: `yolov8-seg-client-${suffix}`,
      authFlows: { userSrp: true },
      generateSecret: false,
    });

    // Cognito グループ（配信者 / 視聴者）
    new cognito.CfnUserPoolGroup(this, 'StreamersGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'streamers',
      description: '配信・アップロードが可能なユーザー',
    });
    new cognito.CfnUserPoolGroup(this, 'ViewersGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'viewers',
      description: '視聴のみ可能なユーザー',
    });

    // S3: フロントエンド静的ファイル（CloudFront + OAC 経由で配信）
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `yolov8-seg-frontend-${suffix}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // S3: MP4アップロード先（ブラウザからの直接PUT用にCORS設定）
    const bucket = new s3.Bucket(this, 'Videos', {
      bucketName: `yolov8-seg-${suffix}`,
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // SQS: MP4処理キュー（S3イベント → SQS → EC2）
    const queue = new sqs.Queue(this, 'Mp4Queue', {
      queueName: `yolov8-seg-mp4-${suffix}`,
      visibilityTimeout: cdk.Duration.minutes(15),
    });

    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(queue),
      { prefix: 'uploads/', suffix: '.mp4' },
    );

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    // Confused Deputy 対策の秘密ヘッダー値。cdk.json で設定、空の場合は検証スキップ。
    // 設定例: openssl rand -hex 16 で生成した値を cdk.json の origin_verify_secret に記入。
    const originVerifySecret: string = this.node.tryGetContext('origin_verify_secret') ?? '';

    // ポート 8080/8765 は CloudFront が転送するため全 IP に開放が必要。
    // CloudFront マネージドプレフィックスリスト (pl-58a04531) は 55+ エントリを持つため
    // 2 ルール分で 110 スロット消費し、SG デフォルト上限 60 を超えてしまう。
    // 代替: X-Origin-Verify カスタムヘッダー検証で Confused Deputy 対策を行う。
    // SSH(22)/RTMP(1935)/React dev(3000) は廃止。EC2 管理は SSM Session Manager で行う。
    const sg = new ec2.SecurityGroup(this, 'Sg', { vpc, description: 'yolov8-seg' });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'API (CloudFront proxy)');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8765), 'WebSocket (CloudFront proxy)');

    // ECRリポジトリ（Mac でビルドしたイメージの置き場。名前固定で scripts から参照）
    const ecrRepo = new ecr.Repository(this, 'EcrRepo', {
      repositoryName: `yolov8-seg-${suffix}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const role = new iam.Role(this, 'Ec2Role', {
      roleName: `yolov8-seg-ec2-role-${suffix}`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });
    bucket.grantReadWrite(role);
    queue.grantConsumeMessages(role);
    ecrRepo.grantPull(role);
    // cfn-signal（UserData の完了通知）に必要
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudformation:SignalResource'],
      resources: [cdk.Aws.STACK_ID],
    }));

    // アプリ一式を S3 アセット化して EC2 の UserData から取得（scp 不要）
    const appAsset = new s3assets.Asset(this, 'AppAsset', {
      path: path.join(__dirname, '..', '..'),
      exclude: [
        '**/node_modules', '**/cdk.out*', '.git', '.git/**',
        '**/*.pem', 'frontend/dist', 'cdk/cdk.context.json',
      ],
    });
    appAsset.grantRead(role);

    const keyPair = new ec2.KeyPair(this, 'Key', {
      keyPairName: `yolov8-seg-key-${suffix}`,
    });

    // Deep Learning AMI (Ubuntu 22.04) - CUDA・PyTorch プリインストール済み
    const ami = ec2.MachineImage.lookup({
      name: 'Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*',
      owners: ['amazon'],
    });

    // 初期デプロイは t3.large (CPU)。GPU推論時は switch_to_gpu.sh で切り替え
    const userData = ec2.UserData.forLinux();

    const instance = new ec2.Instance(this, 'Gpu', {
      vpc,
      instanceType: new ec2.InstanceType('t3.large'),
      machineImage: ami,
      securityGroup: sg,
      role,
      keyPair,
      userData,
      blockDevices: [{
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(100),
      }],
    });

    // UserData: Docker + スクリプト導入のみ。イメージは ECR からpull（ecr_build_push.sh で事前push）。
    // ECR にイメージがない場合は起動をスキップ（cfn-signal は成功で送る）。
    const cfnInstance = instance.node.defaultChild as ec2.CfnInstance;
    userData.addCommands(
      'set -x',
      'exec > /var/log/user-data.log 2>&1',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update -y',
      'apt-get install -y python3-pip unzip',
      // cfn-signal（aws-cfn-bootstrap）を導入し、以降どこで失敗しても失敗通知する
      'pip3 install https://s3.amazonaws.com/cloudformation-examples/aws-cfn-bootstrap-py3-latest.tar.gz',
      `trap '/usr/local/bin/cfn-signal -e $? --stack ${cdk.Aws.STACK_NAME} --resource ${cfnInstance.logicalId} --region ${cdk.Aws.REGION}' EXIT`,
      // Docker インストール
      'install -m 0755 -d /etc/apt/keyrings',
      'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc',
      'chmod a+r /etc/apt/keyrings/docker.asc',
      'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list',
      'apt-get update -y',
      'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin',
      'usermod -aG docker ubuntu',
      // スクリプト一式を S3 アセットから取得
      'mkdir -p /opt/app',
      `aws s3 cp s3://${appAsset.s3BucketName}/${appAsset.s3ObjectKey} /tmp/app.zip --region ${cdk.Aws.REGION}`,
      'unzip -o /tmp/app.zip -d /opt/app',
      // env ファイル（値は deploy 時に確定。ECR_REPO_URI はコンテナ起動スクリプトが参照）
      'cat > /etc/yolov8-seg.env <<EOF',
      `ECR_REPO_URI=${ecrRepo.repositoryUri}`,
      `SQS_QUEUE_URL=${queue.queueUrl}`,
      `S3_BUCKET_NAME=${bucket.bucketName}`,
      `COGNITO_USER_POOL_ID=${userPool.userPoolId}`,
      `COGNITO_APP_CLIENT_ID=${userPoolClient.userPoolClientId}`,
      `AWS_DEFAULT_REGION=${cdk.Aws.REGION}`,
      'MODEL_PATH=/app/best.pt',
      `ORIGIN_VERIFY_SECRET=${originVerifySecret}`,
      'EOF',
      'chmod 600 /etc/yolov8-seg.env',
      // CPU/GPU 自動切替サービスを登録
      'install -m 700 /opt/app/scripts/docker_start_auto.sh /usr/local/bin/docker_start_auto.sh',
      'install -m 644 /opt/app/scripts/yolov8-seg.service /etc/systemd/system/yolov8-seg.service',
      'systemctl daemon-reload',
      'systemctl enable yolov8-seg.service',
      // 起動試行（ECRにイメージがなければスキップして正常終了）
      'systemctl start yolov8-seg.service || true',
    );

    // イメージビルドがないため短い timeout で十分
    cfnInstance.cfnOptions.creationPolicy = {
      resourceSignal: { count: 1, timeout: 'PT15M' },
    };

    // CloudFront Function: /api/* → EC2 転送時に /api プレフィックスを除去
    const apiRewriteFn = new cloudfront.Function(this, 'ApiRewriteFn', {
      code: cloudfront.FunctionCode.fromInline([
        'function handler(event) {',
        '  var req = event.request;',
        '  if (req.uri.indexOf("/api/") === 0) { req.uri = req.uri.substring(4); }',
        '  return req;',
        '}',
      ].join('\n')),
    });

    // CloudFront: S3(フロントエンド) + EC2(API/WebSocket) を一つのドメインで提供
    // ※ EC2 の IP は起動中でないと DNS が解決できないため cdk deploy はインスタンス起動中に実行すること。
    //   IP 変更後（GPU切替後）は update_cloudfront_origin.sh で Origin を更新する。
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(instance.instancePublicDnsName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            httpPort: 8080,
            readTimeout: cdk.Duration.seconds(60),
            customHeaders: originVerifySecret ? { 'X-Origin-Verify': originVerifySecret } : {},
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{
            function: apiRewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
        '/ws': {
          origin: new origins.HttpOrigin(instance.instancePublicDnsName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            httpPort: 8765,
            readTimeout: cdk.Duration.seconds(60),
            customHeaders: originVerifySecret ? { 'X-Origin-Verify': originVerifySecret } : {},
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // NOTE: instancePublicIp は停止中インスタンスでは属性が消え、スタック更新が
    // "Attribute 'PublicIp' does not exist" で失敗する。停止耐性のある InstanceId を出力し、
    // IP は運用時に `aws ec2 describe-instances` で取得する。
    new cdk.CfnOutput(this, 'CloudFrontUrl',       { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'DistributionId',      { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'FrontendBucketName',  { value: frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'InstanceId',          { value: instance.instanceId });
    new cdk.CfnOutput(this, 'EcrRepoUri',          { value: ecrRepo.repositoryUri });
    new cdk.CfnOutput(this, 'BucketName',          { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'QueueUrl',            { value: queue.queueUrl });
    new cdk.CfnOutput(this, 'KeyPairId',           { value: keyPair.keyPairId });
    new cdk.CfnOutput(this, 'UserPoolId',          { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId',    { value: userPoolClient.userPoolClientId });
  }
}

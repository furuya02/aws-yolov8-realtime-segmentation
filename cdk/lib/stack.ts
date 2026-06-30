import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

export class YoloSegStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const suffix = this.node.tryGetContext('bucket_suffix') ?? this.account;

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

    const sg = new ec2.SecurityGroup(this, 'Sg', { vpc, description: 'yolov8-seg' });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22),   'SSH');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(1935), 'RTMP');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8765), 'WebSocket');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'API');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), 'React dev');

    const role = new iam.Role(this, 'Ec2Role', {
      roleName: `yolov8-seg-ec2-role-${suffix}`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });
    bucket.grantReadWrite(role);
    queue.grantConsumeMessages(role);

    const keyPair = new ec2.KeyPair(this, 'Key', {
      keyPairName: `yolov8-seg-key-${suffix}`,
    });

    // Deep Learning AMI (Ubuntu 22.04) - CUDA・PyTorch プリインストール済み
    const ami = ec2.MachineImage.lookup({
      name: 'Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*',
      owners: ['amazon'],
    });

    const instance = new ec2.Instance(this, 'Gpu', {
      vpc,
      instanceType: new ec2.InstanceType('g4dn.xlarge'),
      machineImage: ami,
      securityGroup: sg,
      role,
      keyPair,
      blockDevices: [{
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(100),
      }],
    });

    new cdk.CfnOutput(this, 'PublicIp',   { value: instance.instancePublicIp });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'QueueUrl',   { value: queue.queueUrl });
    new cdk.CfnOutput(this, 'KeyPairId',  { value: keyPair.keyPairId });
  }
}

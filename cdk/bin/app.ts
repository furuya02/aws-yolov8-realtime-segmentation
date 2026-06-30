import * as cdk from 'aws-cdk-lib';
import { YoloSegStack } from '../lib/stack';

const app = new cdk.App();
new YoloSegStack(app, 'YoloSegStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});

import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config/environments.js";

interface WafStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
}

export class WafStack extends cdk.Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const { envConfig } = props;

    const webAcl = new wafv2.CfnWebACL(this, "web-acl", {
      name: `ask-archil-io-${envConfig.stage}-web-acl`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `ask-archil-io-${envConfig.stage}-web-acl`,
        sampledRequestsEnabled: true,
      },
      rules: [
        // Block requests from IPs with known bad reputation (bots, scrapers, malicious actors)
        {
          name: "AWSManagedRulesAmazonIpReputationList",
          priority: 10,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAmazonIpReputationList",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesAmazonIpReputationList",
            sampledRequestsEnabled: true,
          },
        },
        // Block OWASP Top 10: SQLi, XSS, path traversal, bad user agents
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 20,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesCommonRuleSet",
            sampledRequestsEnabled: true,
          },
        },
        // Block known exploit payloads: Log4Shell, Spring4Shell, null bytes
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 30,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesKnownBadInputsRuleSet",
            sampledRequestsEnabled: true,
          },
        },
        // Rate limit: block any IP sending more than 300 requests per 5 minutes
        {
          name: "RateLimitRule",
          priority: 40,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 300,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitRule",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;

    new cdk.CfnOutput(this, "web-acl-arn", {
      description: "WAF Web ACL ARN for CloudFront",
      value: this.webAclArn,
      exportName: `ask-archil-io-web-acl-arn-${envConfig.stage}`,
    });
  }
}

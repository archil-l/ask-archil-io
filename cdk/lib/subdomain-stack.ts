import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";

export interface SubdomainStackProps extends cdk.StackProps {
  domainName: string;
  parentHostedZoneId?: string;
  parentDelegationRoleArn?: string;
}

/**
 * Subdomain Stack - for creating a subdomain hosted zone and ACM certificate
 *
 * This stack creates:
 * - A hosted zone for the subdomain (e.g., ask.archil.io)
 * - An ACM certificate with DNS validation using the owned zone
 * - Optionally updates NS delegation records in parent account via custom resource
 *
 * Usage in consuming account:
 * const subdomainStack = new SubdomainStack(app, "agent-subdomain-stack", {
 *   env: { account: "260448775808", region: "us-east-1" },
 *   domainName: "ask.archil.io",
 *   parentHostedZoneId: "Z<parent-zone-id>",
 *   parentDelegationRoleArn: "arn:aws:iam::359373592118:role/agent-archil-io-dns-delegation-role",
 * });
 *
 * The custom resource will automatically update NS delegation in parent account
 * before certificate validation begins.
 */
export class SubdomainStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: SubdomainStackProps) {
    super(scope, id, props);

    // Create hosted zone for this subdomain
    this.hostedZone = new route53.HostedZone(this, "subdomain-zone", {
      zoneName: props.domainName,
    });

    // Create custom resource to update NS records in parent account (if configured)
    let nsUpdateResource: cdk.custom_resources.AwsCustomResource | undefined;
    if (props.parentHostedZoneId && props.parentDelegationRoleArn) {
      nsUpdateResource = this.createNsUpdateCustomResource(
        props.domainName,
        props.parentHostedZoneId,
        props.parentDelegationRoleArn,
      );
    }

    // Create ACM certificate with DNS validation
    // Since this account owns the zone, DNS validation works seamlessly
    this.certificate = new acm.Certificate(this, "subdomain-certificate", {
      domainName: props.domainName,
      subjectAlternativeNames: [`*.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // Ensure NS record is updated before certificate validation
    if (nsUpdateResource) {
      this.certificate.node.addDependency(nsUpdateResource);
    }

    // Outputs for configuring NS delegation in parent account
    const sanitizedDomainName = props.domainName.replace(/\./g, "-");

    new cdk.CfnOutput(this, "hosted-zone-id", {
      description: `Hosted Zone ID for ${props.domainName}`,
      value: this.hostedZone.hostedZoneId,
      exportName: `${sanitizedDomainName}-zone-id`,
    });

    new cdk.CfnOutput(this, "nameservers", {
      description: `Nameservers for ${props.domainName} - automatically delegated via custom resource`,
      value: cdk.Fn.join(", ", this.hostedZone.hostedZoneNameServers || []),
      exportName: `${sanitizedDomainName}-nameservers`,
    });

    new cdk.CfnOutput(this, "certificate-arn", {
      description: `ACM Certificate ARN for ${props.domainName}`,
      value: this.certificate.certificateArn,
      exportName: `${sanitizedDomainName}-certificate-arn`,
    });
  }

  private createNsUpdateCustomResource(
    subdomain: string,
    parentHostedZoneId: string,
    delegationRoleArn: string,
  ): cdk.custom_resources.AwsCustomResource {
    // Lambda function to update NS records in parent account
    // Uses NodejsFunction for automatic TypeScript compilation with esbuild
    const nsUpdateLogGroup = new logs.LogGroup(this, "ns-update-log-group", {
      logGroupName: `/aws/lambda/ask-archil-io-ns-update-lambda`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const nsUpdateLambda = new lambdaNodejs.NodejsFunction(
      this,
      "ns-update-lambda",
      {
        // Use process.cwd() for absolute path from project root
        // This works regardless of whether we're running from source or compiled code
        entry: path.join(
          process.cwd(),
          "cdk/lambdas/ns-record-updater/index.ts",
        ),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        bundling: {
          format: lambdaNodejs.OutputFormat.CJS,
          target: "node24",
          // AWS SDK v3 is pre-installed in Node 24 runtime, so we exclude it from bundling
          externalModules: ["@aws-sdk/client-sts", "@aws-sdk/client-route-53"],
        },
        timeout: cdk.Duration.minutes(5),
        memorySize: 256,
        logGroup: nsUpdateLogGroup,
      },
    );

    // Allow Lambda to assume the delegation role
    nsUpdateLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [delegationRoleArn],
      }),
    );

    // Allow Lambda to read NS records from child zone
    nsUpdateLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["route53:ListResourceRecordSets"],
        resources: [
          `arn:aws:route53:::hostedzone/${this.hostedZone.hostedZoneId}`,
        ],
      }),
    );

    // Create custom resource that calls the Lambda
    const customResource = new cdk.custom_resources.AwsCustomResource(
      this,
      "ns-update-custom-resource",
      {
        onUpdate: {
          service: "Lambda",
          action: "invoke",
          parameters: {
            FunctionName: nsUpdateLambda.functionName,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({
              childHostedZoneId: this.hostedZone.hostedZoneId,
              parentHostedZoneId,
              delegationRoleArn,
              subdomain,
            }),
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            `ns-update-${subdomain}-${Date.now()}`,
          ),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cdk.custom_resources.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      },
    );

    // Grant Lambda invoke permission to the custom resource
    nsUpdateLambda.grantInvoke(customResource);

    return customResource;
  }
}

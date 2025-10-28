# Production-grade CloudFormation template (full file) **plus** a clear README you can drop into your repo.

## Improvement for correctness: 

**the Target Group is now passed as a Target Group ARN** (not just name). 

CloudWatch ALB metrics require the `targetgroup/<name>/<id>` dimension value; using the ARN lets us derive that value reliably.

Same for the ALB: we derive `app/<name>/<id>` from the ALB ARN.

---

# CloudFormation: ALB Availability + Route53 External Health + 4XX% Alarm

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: >
  ALB availability monitoring with CloudWatch and Route53.
  Adds alarms for: backend 5XX count, unhealthy hosts, zero 2XX (black-hole),
  4XX error rate (%), and Route53 external health check status.
  Safe to deploy across dev/stage/prod; no app changes required.

Parameters:

  EnvironmentName:
    Type: String
    AllowedPattern: "^[a-z0-9-]+$"
    Description: Short identifier for the environment (e.g., dev, stage, prod)

  LoadBalancerArn:
    Type: String
    Description: ARN of the Application Load Balancer to monitor (arn:aws:elasticloadbalancing:region:acct:loadbalancer/app/NAME/ID)

  TargetGroupArn:
    Type: String
    Description: ARN of the ALB Target Group (arn:aws:elasticloadbalancing:region:acct:targetgroup/NAME/ID)

  AlarmSNSTopicARN:
    Type: String
    Description: ARN of SNS topic to notify when alarms trigger

  HealthCheckDomainName:
    Type: String
    Description: Public DNS name users access (e.g., app.example.com)

  HealthCheckPath:
    Type: String
    Default: "/health"
    Description: HTTP path that returns 200 OK when app is healthy

  # Thresholds (override per env if needed)
  Target5XXPerMinuteThreshold:
    Type: Number
    Default: 10
    Description: Sum of Target 5XX per 60s period to alarm on (burst detection)

  UnhealthyHostCountThreshold:
    Type: Number
    Default: 1
    Description: Number of unhealthy targets that should trigger an alarm

  Zero2XXMinutes:
    Type: Number
    Default: 5
    Description: Minutes with no 2XX responses before alarming (black-hole detection)

  FourXXRatePercentThreshold:
    Type: Number
    Default: 10
    Description: 4XX as % of total requests to alarm on (client error surge)

  FourXXRateEvalPeriods:
    Type: Number
    Default: 3
    Description: Evaluation periods (minutes) for sustained 4XX rate

  Route53HealthFailPeriods:
    Type: Number
    Default: 3
    Description: Number of 30s intervals failing before the R53 status alarm triggers

Mappings: {}

Conditions: {}

Resources:

  # ---------- Helpers: Dimensions derived from ARNs ----------
  # ALB metric dimension requires 'app/<name>/<id>'
  LoadBalancerDimension:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/monitoring/${EnvironmentName}/alb-dimension"
      Type: String
      Value: !Join
        - "/"
        - - !Select [1, !Split ["/", !Ref LoadBalancerArn]]  # "app"
          - !Select [2, !Split ["/", !Ref LoadBalancerArn]]  # "<name>"
          - !Select [3, !Split ["/", !Ref LoadBalancerArn]]  # "<id>"
      Description: Derived ALB dimension string for CloudWatch metrics (app/<name>/<id>)

  # TargetGroup metric dimension requires 'targetgroup/<name>/<id>'
  TargetGroupDimension:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/monitoring/${EnvironmentName}/tg-dimension"
      Type: String
      Value: !Join
        - "/"
        - - !Select [1, !Split ["/", !Ref TargetGroupArn]]  # "targetgroup"
          - !Select [2, !Split ["/", !Ref TargetGroupArn]]  # "<name>"
          - !Select [3, !Split ["/", !Ref TargetGroupArn]]  # "<id>"
      Description: Derived TargetGroup dimension string for CloudWatch metrics (targetgroup/<name>/<id>)

  # ---------- Route53 External Health Check ----------
  Route53HealthCheck:
    Type: AWS::Route53::HealthCheck
    Properties:
      HealthCheckConfig:
        Type: HTTP
        FullyQualifiedDomainName: !Ref HealthCheckDomainName
        ResourcePath: !Ref HealthCheckPath
        RequestInterval: 30          # 30s checks
        FailureThreshold: 3          # ~90s to red
      HealthCheckTags:
        - Key: Name
          Value: !Sub "${EnvironmentName}-App-External-HealthCheck"

  # CloudWatch alarm on the Route53 health check status
  Route53HealthCheckAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-Route53-ExternalHealth-Down"
      AlarmDescription: >
        Outside-in check is failing (HTTP non-200 or unreachable) for the public endpoint.
        Detects DNS, network, WAF, or LB path issues from the client perspective.
      Namespace: AWS/Route53
      MetricName: HealthCheckStatus
      Dimensions:
        - Name: HealthCheckId
          Value: !Ref Route53HealthCheck
      Statistic: Minimum
      Period: 30
      EvaluationPeriods: !Ref Route53HealthFailPeriods
      Threshold: 1
      ComparisonOperator: LessThanThreshold
      TreatMissingData: breaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

  # ---------- ALB: Backend 5XX Count ----------
  Target5XXAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-Target-5XX-High"
      AlarmDescription: >
        Backend application returning many 5XX responses while reachable.
        Typically indicates app errors under load, bad deploy, or dependency failure.
      Namespace: AWS/ApplicationELB
      MetricName: HTTPCode_Target_5XX_Count
      Dimensions:
        - Name: LoadBalancer
          Value: !GetAtt LoadBalancerDimension.Value
        - Name: TargetGroup
          Value: !GetAtt TargetGroupDimension.Value
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 3
      Threshold: !Ref Target5XXPerMinuteThreshold
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

  # ---------- ALB: Unhealthy Targets ----------
  UnhealthyHostsAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-UnhealthyHosts"
      AlarmDescription: >
        One or more targets behind the ALB are failing health checks.
        The ALB may have reduced or zero capacity to serve traffic.
      Namespace: AWS/ApplicationELB
      MetricName: UnHealthyHostCount
      Dimensions:
        - Name: TargetGroup
          Value: !GetAtt TargetGroupDimension.Value
        - Name: LoadBalancer
          Value: !GetAtt LoadBalancerDimension.Value
      Statistic: Maximum
      Period: 60
      EvaluationPeriods: 2
      Threshold: !Ref UnhealthyHostCountThreshold
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: breaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

  # ---------- ALB: Zero 2XX (Black-hole) ----------
  Zero2XXAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-No-Successful-Requests"
      AlarmDescription: >
        No successful (2XX) responses for several minutes.
        Detects DNS/routing issues or total outage where requests are not succeeding.
      Namespace: AWS/ApplicationELB
      MetricName: HTTPCode_Target_2XX_Count
      Dimensions:
        - Name: LoadBalancer
          Value: !GetAtt LoadBalancerDimension.Value
        - Name: TargetGroup
          Value: !GetAtt TargetGroupDimension.Value
      Statistic: Sum
      Period: 60
      EvaluationPeriods: !Ref Zero2XXMinutes
      Threshold: 1
      ComparisonOperator: LessThanThreshold
      TreatMissingData: breaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

  # ---------- ALB: 4XX Error Rate (%) using Metric Math ----------
  FourXXRateAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-4XX-Rate-High"
      AlarmDescription: >
        Client-error rate is high (4XX as a percentage of total requests).
        Useful for detecting auth failures, misconfigurations, or breaking API changes.
      ComparisonOperator: GreaterThanThreshold
      EvaluationPeriods: !Ref FourXXRateEvalPeriods
      Threshold: !Ref FourXXRatePercentThreshold
      TreatMissingData: notBreaching
      AlarmActions: [!Ref AlarmSNSTopicARN]
      Metrics:
        - Id: req
          MetricStat:
            Metric:
              Namespace: AWS/ApplicationELB
              MetricName: RequestCount
              Dimensions:
                - Name: LoadBalancer
                  Value: !GetAtt LoadBalancerDimension.Value
                - Name: TargetGroup
                  Value: !GetAtt TargetGroupDimension.Value
            Period: 60
            Stat: Sum
          ReturnData: false
        - Id: e4xx
          MetricStat:
            Metric:
              Namespace: AWS/ApplicationELB
              MetricName: HTTPCode_Target_4XX_Count
              Dimensions:
                - Name: LoadBalancer
                  Value: !GetAtt LoadBalancerDimension.Value
                - Name: TargetGroup
                  Value: !GetAtt TargetGroupDimension.Value
            Period: 60
            Stat: Sum
          ReturnData: false
        - Id: rate
          Expression: "(e4xx / MAX([req, 1])) * 100"
          Label: "4XX Error Rate (%)"
          ReturnData: true

Outputs:
  Route53HealthCheckId:
    Description: ID of the Route53 Health Check
    Value: !Ref Route53HealthCheck

  LoadBalancerMetricDimension:
    Description: Dimension string used by CloudWatch for the ALB
    Value: !GetAtt LoadBalancerDimension.Value

  TargetGroupMetricDimension:
    Description: Dimension string used by CloudWatch for the Target Group
    Value: !GetAtt TargetGroupDimension.Value
```

---

# README.md (drop in your repo)

## Overview

This stack adds **outside-in and inside-the-edge** availability monitoring for an **Application Load Balancer (ALB)**:

* **Route53 External Health Check** (client-perspective reachability)
* **ALB Backend 5XX Count** (server failures while reachable)
* **ALB Unhealthy Host Count** (targets failing ALB health checks)
* **ALB Zero 2XX** (black-hole or total outage detection)
* **ALB 4XX Error Rate %** (client/auth/misuse spikes)

It’s safe to deploy to **dev / stage / prod** and does not modify your application.

## What It Detects (plain English)

| Signal                       | What it tells us                         | Typical causes                                                            |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Route53 External Health Down | Clients can’t reach the app (HTTP fails) | DNS, WAF rules, misrouting, cert/HTTPS issues, LB path errors             |
| Target 5XX High              | App is reachable but failing requests    | App bug, dependency outage, bad deploy                                    |
| Unhealthy Hosts              | ALB can’t find healthy targets           | Container crashloop, instance down, SG/NACL mistakes                      |
| No 2XX for N minutes         | Nothing is succeeding                    | DNS cutover gone wrong, misconfigured listener/target group, total outage |
| 4XX % High                   | Clients are rejected at a high rate      | Auth failures, API changes, malformed requests, feature flags             |

## Parameters

| Name                          | Type   | Example                                                     | Notes                           |
| ----------------------------- | ------ | ----------------------------------------------------------- | ------------------------------- |
| `EnvironmentName`             | String | `prod`                                                      | Used in alarm names/tags        |
| `LoadBalancerArn`             | String | `arn:aws:elasticloadbalancing:...:loadbalancer/app/web/123` | Must be **ALB ARN**             |
| `TargetGroupArn`              | String | `arn:aws:elasticloadbalancing:...:targetgroup/api/456`      | Must be **TG ARN**              |
| `AlarmSNSTopicARN`            | String | `arn:aws:sns:...:ops-alerts`                                | Where alarms notify             |
| `HealthCheckDomainName`       | String | `app.example.com`                                           | Public hostname to test         |
| `HealthCheckPath`             | String | `/health`                                                   | Should return HTTP 200          |
| `Target5XXPerMinuteThreshold` | Number | `10`                                                        | Sensitivity for 5XX bursts      |
| `UnhealthyHostCountThreshold` | Number | `1`                                                         | Allowable failed targets        |
| `Zero2XXMinutes`              | Number | `5`                                                         | Minutes with no success         |
| `FourXXRatePercentThreshold`  | Number | `10`                                                        | 4XX % alarm threshold           |
| `FourXXRateEvalPeriods`       | Number | `3`                                                         | Sustained minutes of 4XX%       |
| `Route53HealthFailPeriods`    | Number | `3`                                                         | 30-sec periods before R53 alarm |

**Why ARNs for ALB/TG?** CloudWatch dimensions for ALB require `app/<name>/<id>` and `targetgroup/<name>/<id>`. Deriving those accurately requires the ARNs.

## Deployment

> Choose one method; examples use AWS CLI. Substitute your values.

```bash
STACK_NAME=alb-availability-${ENV}
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file monitoring-alb.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName=${ENV} \
    LoadBalancerArn=arn:aws:elasticloadbalancing:REGION:ACCT:loadbalancer/app/NAME/ID \
    TargetGroupArn=arn:aws:elasticloadbalancing:REGION:ACCT:targetgroup/NAME/ID \
    AlarmSNSTopicARN=arn:aws:sns:REGION:ACCT:ops-alerts \
    HealthCheckDomainName=app.example.com \
    HealthCheckPath=/health
```

### Service Catalog / GitHub

* Commit the template to your repo as a **Service Catalog product** (or nested under an existing product).
* Expose the parameters noted above.
* Grant the operations team permission to launch per environment.

## Tuning Thresholds (quick guidance)

* **Prod**: leave defaults, then calibrate after a week of baselining.
* **Stage/Dev**: consider higher 5XX threshold (e.g., 25/min) and higher 4XX% (e.g., 20%) to avoid noisy alerts during testing.
* If traffic is **very low**, keep **Zero 2XX** enabled (great for “is it up?”) and rely more on **Route53 External Health** than on rates.

## Testing

1. **Route53 External Health**: Temporarily return non-200 from `/health` (e.g., 503) and watch the alarm trip after ~90s.
2. **5XX**: Force your app to emit 500s for a minute (test env).
3. **Unhealthy Host**: Kill one task/pod so the TG reports `UnHealthyHostCount >= 1`.
4. **Zero 2XX**: Blackhole the path or SG to the targets in a sandbox.
5. **4XX %**: Send a burst of unauthorized requests to drive 4XX up.

## Operations Playbook (what to do when it pages)

* **External Health Down** → Check DNS/WAF/cert, then ALB listener rules; verify `/health`.
* **Unhealthy Hosts** → Check target logs/events; confirm container/pod health; verify SG/NACL.
* **Target 5XX High** → Inspect app logs, dependencies (DB, cache, upstreams); roll back suspect deploy.
* **Zero 2XX** → Confirm requests are reaching TG; trace listener → rule → TG; validate health check config.
* **4XX % High** → Look for auth outage (IdP), expired tokens, breaking API changes, or rate-limit hits.

## Explaining This to Management (one-pager)

* We added **five complementary signals** so we can detect outages whether the problem is on the **internet path**, **load balancer**, or **application**.
* **External Health** proves what users see. **ALB metrics** prove what the platform sees.
* Using **percent-based alarms** (like 4XX%) avoids false positives during low volume and catches real client-impact spikes.
* This reduces **MTTD** (detect faster) and **MTTR** (pinpoint layer), improving uptime and user experience.

## Cost

* **CloudWatch Alarms**: pennies per alarm per month.
* **Route53 Health Check**: small monthly fee per check.
* The stack is intentionally lightweight; no constant canaries or Lambda needed.

## Notes / Design Choices

* Dimensions are derived from ARNs to avoid brittle string matching.
* `TreatMissingData` is tuned to avoid noise: **breaching** for “no 2XX” and external health (we want to know), **notBreaching** for burst metrics.
* 4XX% uses metric math: `(4XX / max(Requests,1)) * 100`.

---

If you want, I can also produce:

* A compact **Parameters JSON** example for SC,
* A **manager-facing slide** (one graphic) summarizing signals and actions,
* Or an **Ansible/Terraform wrapper** to deploy this stack consistently across accounts.


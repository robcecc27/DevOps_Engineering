# Second attempt for CF alerts

## What is does - how it changed

* Bulletproof ARN handling (no more `Fn::Select index` errors)
* Internal app + **Route53 health check mirrored to a CloudWatch alarm** (R1)
* Alarms: **5XX count**, **Unhealthy hosts**, **Zero 2XX** (drives Route53 HC), **4XX error-rate %**
* `Zero 2XX` uses **Z1** (treat missing data as *not breaching*) as you chose

---

# 1) CloudFormation template (paste as `monitoring-alb.yml`)

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: >
  ALB availability monitoring with CloudWatch and Route53 (internal-friendly).
  Includes alarms: Target 5XX, Unhealthy Hosts, Zero 2XX (drives Route53 Health Check), 4XX Error Rate %.
  Route53 Health Check uses CloudWatch alarm mirroring (no public probe required).

Parameters:

  EnvironmentName:
    Type: String
    AllowedPattern: "^[a-z0-9-]+$"
    Description: Short identifier (e.g., dev, stage, prod)

  LoadBalancerArn:
    Type: String
    Description: ARN of the ALB (arn:...:loadbalancer/app/NAME/ID)

  TargetGroupArn:
    Type: String
    Description: ARN of the Target Group (arn:...:targetgroup/NAME/ID)

  AlarmSNSTopicARN:
    Type: String
    Description: SNS topic ARN for alarm notifications

  # ---- Thresholds (override per env if needed) ----
  Target5XXPerMinuteThreshold:
    Type: Number
    Default: 10
    Description: Sum of Target 5XX per 60s period to alarm on (burst detection)

  UnhealthyHostCountThreshold:
    Type: Number
    Default: 1
    Description: Number of unhealthy targets to trigger an alarm

  Zero2XXMinutes:
    Type: Number
    Default: 5
    Description: Minutes with no 2XX responses before alarming (black-hole detection)

  FourXXRatePercentThreshold:
    Type: Number
    Default: 10
    Description: 4XX as % of total requests to alarm on

  FourXXRateEvalPeriods:
    Type: Number
    Default: 3
    Description: Evaluation periods (minutes) for sustained 4XX rate

Resources:

  # ---------------------------------------------------------
  # Helpers: Robust CloudWatch metric dimensions from ARNs
  # ---------------------------------------------------------
  # ALB dimension must be "app/<name>/<id>" (no 'loadbalancer/' prefix).
  # Safe method: split on "loadbalancer/" (no position assumptions).
  LoadBalancerDimensionParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/monitoring/${EnvironmentName}/alb-dimension"
      Type: String
      Value: !Select
        - 1
        - !Split
          - "loadbalancer/"
          - !Ref LoadBalancerArn
      Description: Derived ALB dimension for CloudWatch (e.g., app/my-alb/abc123)

  # TargetGroup dimension must be "targetgroup/<name>/<id>" (including prefix).
  # Safe method: split on "targetgroup/" and re-prepend "targetgroup/".
  TargetGroupDimensionParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/monitoring/${EnvironmentName}/tg-dimension"
      Type: String
      Value: !Join
        - ""
        - - "targetgroup/"
          - !Select
            - 1
            - !Split
              - "targetgroup/"
              - !Ref TargetGroupArn
      Description: Derived TG dimension for CloudWatch (e.g., targetgroup/api/xyz789)

  # ---------------------------------------------------------
  # ALARMS
  # ---------------------------------------------------------

  # Backend 5XX Count (burst)
  Target5XXAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-Target-5XX-High"
      AlarmDescription: >
        Backend app returning many 5XX responses (reachable but failing). Indicates
        app/runtime errors, dependency outages, or bad deploys.
      Namespace: AWS/ApplicationELB
      MetricName: HTTPCode_Target_5XX_Count
      Dimensions:
        - Name: LoadBalancer
          Value: !GetAtt LoadBalancerDimensionParam.Value
        - Name: TargetGroup
          Value: !GetAtt TargetGroupDimensionParam.Value
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 3
      Threshold: !Ref Target5XXPerMinuteThreshold
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

  # Unhealthy Hosts
  UnhealthyHostsAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-UnhealthyHosts"
      AlarmDescription: >
        One or more targets behind the ALB are failing health checks. Reduced or zero
        capacity to serve traffic is likely.
      Namespace: AWS/ApplicationELB
      MetricName: UnHealthyHostCount
      Dimensions:
        - Name: TargetGroup
          Value: !GetAtt TargetGroupDimensionParam.Value
        - Name: LoadBalancer
          Value: !GetAtt LoadBalancerDimensionParam.Value
      Statistic: Maximum
      Period: 60
      EvaluationPeriods: 2
      Threshold: !Ref UnhealthyHostCountThreshold
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: breaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

  # Zero 2XX (black-hole / total outage) — drives Route53 HC
  Zero2XXAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-No-Successful-Requests"
      AlarmDescription: >
        No successful (2XX) responses for several minutes. Detects DNS/routing issues or
        total outage where requests are not succeeding.
      Namespace: AWS/ApplicationELB
      MetricName: HTTPCode_Target_2XX_Count
      Dimensions:
        - Name: LoadBalancer
          Value: !GetAtt LoadBalancerDimensionParam.Value
        - Name: TargetGroup
          Value: !GetAtt TargetGroupDimensionParam.Value
      Statistic: Sum
      Period: 60
      EvaluationPeriods: !Ref Zero2XXMinutes
      Threshold: 1
      ComparisonOperator: LessThanThreshold
      TreatMissingData: notBreaching   # Z1 (you chose this)
      AlarmActions: [!Ref AlarmSNSTopicARN]
      OKActions: []

  # 4XX Error Rate (%) using metric math
  FourXXRateAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-ALB-4XX-Rate-High"
      AlarmDescription: >
        Client-error rate is high (4XX as a percentage of total requests). Useful for detecting
        auth failures, breaking API changes, or misconfigurations.
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
                  Value: !GetAtt LoadBalancerDimensionParam.Value
                - Name: TargetGroup
                  Value: !GetAtt TargetGroupDimensionParam.Value
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
                  Value: !GetAtt LoadBalancerDimensionParam.Value
                - Name: TargetGroup
                  Value: !GetAtt TargetGroupDimensionParam.Value
            Period: 60
            Stat: Sum
          ReturnData: false
        - Id: rate
          Expression: "(e4xx / MAX([req, 1])) * 100"
          Label: "4XX Error Rate (%)"
          ReturnData: true

  # ---------------------------------------------------------
  # Route53 Health Check (R1): mirrors the CloudWatch Zero2XX alarm
  # ---------------------------------------------------------
  Route53HealthCheck:
    Type: AWS::Route53::HealthCheck
    Properties:
      HealthCheckConfig:
        Type: CLOUDWATCH_METRIC
        CloudWatchAlarmName: !Ref Zero2XXAlarm
        CloudWatchAlarmRegion: !Ref AWS::Region
        InsufficientDataHealthStatus: Healthy
      HealthCheckTags:
        - Key: Name
          Value: !Sub "${EnvironmentName}-App-Availability-From-CW"

  # Optional: CloudWatch alarm watching the Route53 health check status (visibility)
  Route53HealthStatusAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${EnvironmentName}-Route53-HealthCheck-Unhealthy"
      AlarmDescription: >
        Route53 health check (mirroring the Zero2XX alarm) is Unhealthy.
      Namespace: AWS/Route53
      MetricName: HealthCheckStatus
      Dimensions:
        - Name: HealthCheckId
          Value: !Ref Route53HealthCheck
      Statistic: Minimum
      Period: 60
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: LessThanThreshold
      TreatMissingData: breaching
      AlarmActions: [!Ref AlarmSNSTopicARN]

Outputs:
  Route53HealthCheckId:
    Description: ID of the Route53 Health Check (mirrors Zero2XX alarm)
    Value: !Ref Route53HealthCheck

  LoadBalancerMetricDimension:
    Description: Dimension string used by CloudWatch for the ALB
    Value: !GetAtt LoadBalancerDimensionParam.Value

  TargetGroupMetricDimension:
    Description: Dimension string used by CloudWatch for the Target Group
    Value: !GetAtt TargetGroupDimensionParam.Value
```

---

# 2) README (drop in as `README.md`)

## ALB Availability Monitoring (Internal) + Route53 via CloudWatch Alarm

This stack adds **internal-friendly** availability monitoring for an **Application Load Balancer (ALB)** and creates a **Route53 health check** that mirrors a CloudWatch alarm (no public probing required).

### What’s Included

* **Target 5XX High** — app reachable but failing
* **Unhealthy Hosts** — ALB has failing targets
* **Zero 2XX** — nothing is succeeding (black-hole/total outage)
* **4XX Error-Rate %** — client-side/auth spikes
* **Route53 Health Check** (Type: `CLOUDWATCH_METRIC`) tied to **Zero 2XX** alarm

  * If Zero 2XX = **ALARM**, Route53 HC = **Unhealthy**
  * Works for **internal-only** apps

### Parameters

| Name                          | Example                                                     | Notes                       |
| ----------------------------- | ----------------------------------------------------------- | --------------------------- |
| `EnvironmentName`             | `prod`                                                      | Used in names/tags          |
| `LoadBalancerArn`             | `arn:aws:elasticloadbalancing:...:loadbalancer/app/web/123` | ALB ARN                     |
| `TargetGroupArn`              | `arn:aws:elasticloadbalancing:...:targetgroup/api/456`      | Target Group ARN            |
| `AlarmSNSTopicARN`            | `arn:aws:sns:REGION:ACCT:ops-alerts`                        | Where alarms notify         |
| `Target5XXPerMinuteThreshold` | `10`                                                        | Burst threshold             |
| `UnhealthyHostCountThreshold` | `1`                                                         | Allowable unhealthy targets |
| `Zero2XXMinutes`              | `5`                                                         | Minutes with no 2XX         |
| `FourXXRatePercentThreshold`  | `10`                                                        | Percent of requests         |
| `FourXXRateEvalPeriods`       | `3`                                                         | Sustained minutes           |

### Deploy (CLI example)

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
    AlarmSNSTopicARN=arn:aws:sns:REGION:ACCT:ops-alerts
```

> **Service Catalog:** expose the same parameters; no additional permissions beyond creating CW alarms, SSM parameters, and a Route53 health check.

### Tuning

* **Prod:** defaults are reasonable; adjust after a week of baselining.
* **Dev/Stage:** consider higher 5XX/4XX thresholds to avoid noise.
* `Zero 2XX` uses **Z1** (missing data = not breaching) so quiet periods don’t page you.

### How to explain this to management

* We use **five complementary signals** so we can detect issues at the **application**, **load balancer**, and **client-perceived availability** layers.
* The **Route53 health check** mirrors the **Zero-2XX** alarm, giving us a single “is it working?” status that also supports DNS failover if needed.
* This reduces detection and recovery time by telling us **what failed** (app vs infra vs routing) instead of just “it’s down.”

---

# 3) Quick tips if anything errors during deploy

* **`Fn::Select cannot select`**: solved here by splitting on fixed text (`loadbalancer/`, `targetgroup/`) rather than numeric indexes.
* **`AccessDenied: route53`**: ensure the product role can `route53:CreateHealthCheck` and `route53:ChangeTagsForResource`.
* **No traffic at night**: You chose **Z1**, so *missing data ≠ outage*. If you ever want to make “no traffic” unhealthy, switch `TreatMissingData` on `Zero2XXAlarm` to `breaching`.




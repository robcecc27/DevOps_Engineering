Here's how to set up all the requested **AWS CloudWatch alarms** and **budgets/alerts** for your PostgreSQL DB (Aurora or RDS), billing, and container storage usage. I’ll break them down into sections and include CLI, console, or Terraform options if needed.

---

## **1. PostgreSQL DB Alerts (CPU, IOPS, Memory)**

Assumes you’re using **Amazon RDS or Aurora PostgreSQL**.

### a. **CPU Utilization**

Metric: `CPUUtilization`
Namespace: `AWS/RDS`
Threshold: e.g., > 80% for 5 minutes

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "High-CPU-RDS" \
  --metric-name CPUUtilization \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=DBInstanceIdentifier,Value=<your-db-identifier> \
  --evaluation-periods 2 \
  --alarm-actions <SNS-ARN> \
  --ok-actions <SNS-ARN> \
  --unit Percent
```

### b. **Read/Write IOPS**

Metrics: `ReadIOPS`, `WriteIOPS`
Use the same structure as above, just change `--metric-name`.

### c. **Freeable Memory**

Metric: `FreeableMemory`
Threshold: Set a lower bound (e.g., < 200 MB)

```bash
--metric-name FreeableMemory \
--threshold 200000000 \
--comparison-operator LessThanThreshold \
--unit Bytes
```

> Note: For Aurora, use the **DBClusterIdentifier** or `AWS/RDS` with different dimensions (`DBClusterIdentifier` vs `DBInstanceIdentifier`).

---

## **2. Billing Alarms**

> Requires **linked account** CloudWatch access to billing data and `us-east-1` region.

### a. **Monthly Spend > \$2500**

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "Billing-Over-2500" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --threshold 2500 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=Currency,Value=USD \
  --evaluation-periods 1 \
  --alarm-actions <SNS-ARN> \
  --region us-east-1
```

### b. **Forecasted Spend > \$3000**

Use **AWS Budgets**, not CloudWatch:

```bash
aws budgets create-budget \
  --account-id <account-id> \
  --budget file://budget-forecast.json
```

**budget-forecast.json**:

```json
{
  "BudgetName": "ForecastOver3000",
  "BudgetLimit": {
    "Amount": "3000",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "FORECAST",
  "CostFilters": {},
  "CostTypes": {
    "IncludeTax": true,
    "IncludeSubscription": true,
    "UseBlended": false
  },
  "NotificationsWithSubscribers": [
    {
      "Notification": {
        "NotificationType": "FORECASTED",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 100
      },
      "Subscribers": [
        {
          "SubscriptionType": "EMAIL",
          "Address": "you@example.com"
        }
      ]
    }
  ]
}
```

---

## **3. Alarm for Container Storage Usage**

Assuming you're monitoring ECS/EKS/EC2 containers:

### a. **EC2/EBS-based containers**

Use CloudWatch agent on EC2/ECS to monitor disk usage:

* Install agent.
* Add `disk_used_percent` metric.

**Example Metric**:

* Namespace: `CWAgent`
* Metric: `disk_used_percent`
* Dimension: `{InstanceId, path}` or `{AutoScalingGroupName}`

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "ContainerStorageFull" \
  --namespace CWAgent \
  --metric-name disk_used_percent \
  --dimensions Name=InstanceId,Value=<your-instance-id> \
  --statistic Average \
  --period 300 \
  --threshold 90 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions <SNS-ARN>
```

### b. **EKS with Prometheus + CloudWatch**

If using Kubernetes, forward Prometheus disk metrics to CloudWatch and alarm similarly.

---

Let me know:

* If you'd prefer Terraform versions of any of these.
* If you're using ECS Fargate or Kubernetes for containers (the approach differs).
* If you want all alarms sent to a unified SNS topic with email/slack.

I can bundle these into templates if you'd like.

# Three modular CloudFormation templates to get you started. You can copy and paste these individually and expand them over time.

---

## **1. RDS Alarms (CPU, IOPS, Memory)**

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: CloudWatch Alarms for RDS PostgreSQL (CPU, IOPS, Memory)

Parameters:
  DBInstanceIdentifier:
    Type: String
    Description: The RDS instance identifier
  AlarmSNSTopicARN:
    Type: String
    Description: ARN of the SNS topic for alarm notifications

Resources:
  CPUUtilizationAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${DBInstanceIdentifier}-HighCPU"
      MetricName: CPUUtilization
      Namespace: AWS/RDS
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 80
      ComparisonOperator: GreaterThanThreshold
      AlarmActions: [!Ref AlarmSNSTopicARN]
      Dimensions:
        - Name: DBInstanceIdentifier
          Value: !Ref DBInstanceIdentifier

  ReadIOPSAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${DBInstanceIdentifier}-HighReadIOPS"
      MetricName: ReadIOPS
      Namespace: AWS/RDS
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 2
      Threshold: 10000
      ComparisonOperator: GreaterThanThreshold
      AlarmActions: [!Ref AlarmSNSTopicARN]
      Dimensions:
        - Name: DBInstanceIdentifier
          Value: !Ref DBInstanceIdentifier

  FreeableMemoryAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${DBInstanceIdentifier}-LowFreeableMemory"
      MetricName: FreeableMemory
      Namespace: AWS/RDS
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 200000000  # 200 MB
      ComparisonOperator: LessThanThreshold
      AlarmActions: [!Ref AlarmSNSTopicARN]
      Dimensions:
        - Name: DBInstanceIdentifier
          Value: !Ref DBInstanceIdentifier
```

---

## **2. Billing Alarms (Actual and Forecasted)**

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Billing Alarms (actual spend and forecast)

Parameters:
  AlarmSNSTopicARN:
    Type: String
    Description: ARN of the SNS topic for alarm notifications

Resources:
  ActualCostAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: "Billing-Actual-Spend-Over-2500"
      MetricName: EstimatedCharges
      Namespace: AWS/Billing
      Statistic: Maximum
      Period: 21600
      EvaluationPeriods: 1
      Threshold: 2500
      ComparisonOperator: GreaterThanThreshold
      AlarmActions: [!Ref AlarmSNSTopicARN]
      Dimensions:
        - Name: Currency
          Value: USD

# Forecast-based alerts must be configured via AWS Budgets, not CloudFormation
# Use CLI or Console to set up a forecast threshold (if needed, I can generate that separately)
```

> ⚠️ CloudWatch Billing metrics are only available in `us-east-1`.

---

## **3. ECS Fargate Container Storage Alarm**

This assumes your Fargate containers are pushing storage metrics to CloudWatch via a custom metric like `disk_used_percent`.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Alarm for ECS Fargate container storage usage

Parameters:
  ECSClusterName:
    Type: String
  ServiceName:
    Type: String
  AlarmSNSTopicARN:
    Type: String

Resources:
  FargateDiskUsageAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${ECSClusterName}-${ServiceName}-DiskUsageHigh"
      Namespace: CWAgent
      MetricName: disk_used_percent
      Statistic: Average
      Period: 300
      EvaluationPeriods: 2
      Threshold: 90
      ComparisonOperator: GreaterThanThreshold
      AlarmActions: [!Ref AlarmSNSTopicARN]
      Dimensions:
        - Name: ClusterName
          Value: !Ref ECSClusterName
        - Name: ServiceName
          Value: !Ref ServiceName
```

---

Would you like:

* A Terraform version of any of these?
* A helper template to deploy the required SNS topic?
* A Budgets CLI-based deployment block for the forecasted spend alert?

Let me know and I’ll extend from here.


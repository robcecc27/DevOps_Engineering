# ALB Availability & Route53 Health Monitoring

**CloudFormation Service Catalog Product**

This Service Catalog product deploys a standardized monitoring package for internal Application Load Balancers (ALBs). It provisions CloudWatch alarms and a Route53 Health Check that evaluates ALB availability without requiring external HTTP probes.

This solution is designed for environments that need reliable internal-only monitoring with minimal false positives across Dev, Stage, and Prod.

---

## Overview

This product provides:

### Monitored Signals

| Monitor               | What it Detects                                | Why it Matters                                                                     |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Target 5XX Spikes     | Application responding but failing             | Detects runtime failures, bad deployments, upstream dependency outages             |
| Unhealthy Host Count  | Targets failing ALB health checks              | Identifies capacity loss or service instability                                    |
| Zero 2XX Responses    | No successful traffic for N minutes            | Catches black-hole scenarios where the app is unreachable or not serving correctly |
| High 4XX Rate         | High client-error % with request-volume guard  | Detects configuration issues, bad client traffic, routing or auth problems         |
| Route53 Health Status | Mirrors Zero-2XX via metric-based health check | Enables failover routing (if configured) and visibility into ALB up/down status    |

---

## Key Design Principles

* **No public HTTP probing required**
  Suitable for internal-only applications, zero exposure of endpoints.

* **Metric-based Route53 Health Check**
  Route53 evaluates CloudWatch metrics directly. It uses the *same* metric, threshold, and evaluation periods as the Zero-2XX alarm for consistency.

* **Noise-reduction controls built-in**

  * Minimum-traffic guard for 4XX alerts
  * TreatMissingData tuned to avoid false alarms during off-hours or low traffic (e.g., non-Prod)

* **Environment-aware thresholds**
  Defaults are safe for most workloads but can be adjusted per environment at provisioning time.

---

## Parameters to Provide at Provisioning Time

| Parameter                   | Description                                     | Example                                        |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| EnvironmentName             | Short env identifier                            | dev, stage, prod                               |
| LoadBalancerDimension       | CloudWatch ALB dimension string                 | `app/myapp-dev-alb/abc123`                     |
| TargetGroupDimension        | CloudWatch TG dimension string                  | `targetgroup/myapp-dev-tg/xyz456`              |
| AlarmSNSTopicARN            | SNS Topic ARN for alarm notifications           | `arn:aws:sns:us-east-1:123456789012:AppAlarms` |
| Target5XXPerMinuteThreshold | 5XX spike threshold per minute                  | 10                                             |
| UnhealthyHostCountThreshold | Number of unhealthy hosts before alarm          | 1                                              |
| Zero2XXMinutes              | Minutes with zero success before alarm          | 5                                              |
| FourXXRatePercentThreshold  | % 4XX to alarm on                               | 10                                             |
| FourXXRateEvalPeriods       | Consecutive minutes above threshold             | 3                                              |
| MinRequestVolumeFor4XX      | Minimum requests/min before evaluating 4XX rate | 50                                             |

> Tip: Set higher 4XX thresholds and higher minimum request volume in lower environments to avoid noise.

---

## What Gets Deployed

The product provisions the following AWS resources:

* **4 CloudWatch Alarms**

  * `<env>-ALB-Target-5XX-High`
  * `<env>-ALB-UnhealthyHosts`
  * `<env>-ALB-No-Successful-Requests`
  * `<env>-ALB-4XX-Rate-High`

* **1 Route53 Metric-Based Health Check**

  * Mirrored logic of Zero-2XX alarm
  * Enables DNS-based failover if implemented

* **1 CloudWatch Alarm for Route53 Health State**

  * `<env>-Route53-HealthCheck-Unhealthy`

* Outputs:

  * `Route53HealthCheckId`

---

## How to Find the Health Check After Deployment

After provisioning, the following output is available in Service Catalog:

* **Route53HealthCheckId** – use this value to:

  * View health state in Route53 console
  * Attach to a failover or multivalue routing policy if desired

---

## Operational Notes

* Designed for both steady-traffic and bursty internal applications.
* “No successful responses” does not alert when traffic is idle due to the `TreatMissingData = notBreaching` setting.
* To integrate with failover routing, attach the Health Check to a Route53 record using Failover or Multivalue routing.

---

## Updating Thresholds Post-Deployment

To adjust alarm sensitivity (e.g., for Prod vs Dev):

1. Open the Service Catalog provisioned product
2. Choose “Update”
3. Modify threshold parameters as needed
4. Re-provision; alarms update without replacement

---

## Support and Maintenance

This monitoring package is intended to be reusable across environments. When updating versions of this Service Catalog product:

* Maintain backward-compatible parameter names where possible
* Document new parameters or behavioral changes clearly in release notes


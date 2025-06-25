## **Progress Summary: Application and Infrastructure Monitoring & Documentation**

### **1. Splunk Dashboard Development**

I created a Splunk dashboard focused on monitoring ECS container performance and Aurora PostgreSQL database health. The dashboard currently includes:

* **CPU Usage Per Container**
  Visualizes CPU utilization over time for individual containers using `CpuUtilized` vs `CpuReserved`, grouped by `TaskId` and `ContainerName`, filtered to only `Type=Container` records for accuracy.

* **Container Uptime Panel**
  Shows the last-seen telemetry timestamp for each container instance to monitor runtime continuity.

* **Aurora DB Uptime Panel**
  Displays the last-reported log entry time per database (`instanceID`), acting as an uptime monitor.

> This lays the groundwork for more advanced observability and makes it easy to expand into memory, task health, and service scaling metrics as needed.

---

### **2. Splunk Alerts Implemented**

#### **a. Alert: Non-Running Containers**

* Triggers when any container’s most recent `ContainerKnownStatus` is not `RUNNING`.
* Runs on a 10-minute interval using a cron schedule (`*/10 * * * *`).
* Helps proactively detect stopped or failed containers at the container level.

#### **b. Alert: Aurora DB Silent for 10+ Minutes**

* Triggers if expected Aurora DB clusters stop sending logs for 10+ minutes.
* Detects outages, disconnects, or monitoring pipeline issues.
* Uses `instanceID` to track each cluster individually.

---

### **3. Existing AWS CloudWatch Dashboards Available**

To complement Splunk monitoring, the following built-in dashboards are available in AWS CloudWatch:

* **ECS Cluster & Service Dashboards:**

  * CPU and memory reservation/utilization
  * Desired vs Running task counts
  * Container Insights for detailed task and container metrics

* **RDS & Aurora Dashboards:**

  * CPU utilization, IOPS, read/write throughput
  * DB connections and freeable memory
  * Enhanced Monitoring and RDSOSMetrics (linked to Splunk via logs)

* **Application-Level Dashboards:**

  * Metrics from Spring Boot/Java apps (if instrumented)
  * Any custom CloudWatch metrics pushed from containers

---

### **4. CloudFormation Template Documentation**

As part of the infrastructure review, I’ve been actively documenting all existing CloudFormation templates. This includes:

* Copying and saving the **generated resource diagram** (from the CloudFormation console) for each stack.
* Extracting and recording the list of **required input parameters** for each template.
* Capturing relationships between resources across stacks to help with onboarding and infrastructure reviews.

---

### **5. Rebuild Process Documentation**

I’ve created a standalone document titled **“Environment Rebuild Guide”**, which outlines:

* The order in which environments (Dev, Stage, Prod) must be rebuilt.
* Prerequisites for each stack and their dependency mappings.
* Known issues and tips for avoiding configuration mismatches.

This guide ensures reproducibility and is being structured to assist both internal engineers and new team members onboarding into the project.

---
### 6. Cost Optimization Implementation
To reduce ongoing cloud spend, I implemented multiple cost-saving strategies across our environments:

Resource Downsizing:
Reviewed and adjusted instance types for EC2, RDS, and migration servers, replacing overprovisioned resources with appropriately sized instances based on utilization metrics.

Automated Scheduling:
Set up daily automation to shut down EC2, ECS services, and RDS instances between 7:00 PM and 7:00 AM, and keep them offline over weekends, unless otherwise needed. This significantly reduces idle resource costs during non-working hours.

These changes provide immediate monthly cost savings and demonstrate proactive cloud governance.

### ✅ **Summary**

While final dashboard tuning is still underway, I’ve completed critical monitoring and documentation groundwork. These assets give us:

* Real-time visibility into key infrastructure components
* Proactive alerting for high-risk conditions
* A mapped, reproducible deployment model for cloud infrastructure


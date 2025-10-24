Here’s a **ready-to-run AWS CLI/Boto3 hybrid-style script** you can drop in as a `.py` file.
It does exactly what you described:

* Reads a list of EC2 instance IDs from a text file (`instances.txt`)
* Creates AMIs with a clean name and description
* Waits for AMI creation completion
* Stops all instances once AMIs are done
* Logs instance names, AMI IDs, and final stopped status to a results file (`ami_backup_results.txt`)

---

### **Script: `create_ami_and_stop.py`**

```python
import boto3
import time
from datetime import datetime

ec2 = boto3.client('ec2')
ec2_resource = boto3.resource('ec2')

input_file = 'instances.txt'
output_file = 'ami_backup_results.txt'

def get_instance_name(tags):
    if tags:
        for tag in tags:
            if tag['Key'] == 'Name':
                return tag['Value']
    return 'UnnamedInstance'

def create_ami(instance_id):
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    instance = ec2_resource.Instance(instance_id)
    name = get_instance_name(instance.tags)
    ami_name = f"{name}-backup-{timestamp}"
    print(f"Creating AMI for {instance_id} ({name}) ...")
    
    response = ec2.create_image(
        InstanceId=instance_id,
        Name=ami_name,
        Description=f"Manual backup for {name} ({instance_id}) on {timestamp}",
        NoReboot=True
    )
    return response['ImageId'], name

def wait_for_ami(ami_id):
    waiter = ec2.get_waiter('image_available')
    print(f"Waiting for AMI {ami_id} to become available ...")
    waiter.wait(ImageIds=[ami_id])
    print(f"AMI {ami_id} is ready.")

def stop_instances(instance_ids):
    print(f"Stopping instances: {', '.join(instance_ids)}")
    ec2.stop_instances(InstanceIds=instance_ids)
    waiter = ec2.get_waiter('instance_stopped')
    waiter.wait(InstanceIds=instance_ids)
    print("All instances stopped.")

def main():
    with open(input_file, 'r') as f:
        instance_ids = [line.strip() for line in f if line.strip()]

    results = []
    for instance_id in instance_ids:
        ami_id, name = create_ami(instance_id)
        wait_for_ami(ami_id)
        results.append((instance_id, name, ami_id))

    stop_instances(instance_ids)

    with open(output_file, 'w') as f:
        f.write("InstanceID,Name,AMI_ID,FinalState\n")
        for instance_id, name, ami_id in results:
            instance = ec2_resource.Instance(instance_id)
            f.write(f"{instance_id},{name},{ami_id},{instance.state['Name']}\n")

    print(f"\nBackup complete. Results saved to {output_file}")

if __name__ == '__main__':
    main()
```

---

### **How to use it**

1. Create a file named **`instances.txt`** in the same directory.
   Example:

   ```
   i-0123456789abcdef0
   i-0abcdef1234567890
   ...
   ```

2. Run the script:

   ```bash
   python3 create_ami_and_stop.py
   ```

3. Output will be in **`ami_backup_results.txt`** with columns:

   ```
   InstanceID,Name,AMI_ID,FinalState
   i-0123456789abcdef0,WebServer,ami-0abcd1234ef567890,stopped
   ```

---

### **Notes**

* Uses `NoReboot=True` to avoid downtime during AMI creation.
* Waiters ensure AMI creation and stop actions fully complete before proceeding.
* You can safely rerun it; AMIs will get timestamped unique names.
* You can modify the region or profile with:

  ```bash
  export AWS_PROFILE=myprofile
  export AWS_REGION=us-east-1
  ```

Would you like me to modify this to **tag the new AMIs** with the same tags as the source instance? That’s usually a best practice for decommission prep.


# Cloudformation docs python script

* Walk through a directory looking for CloudFormation templates (`.yml` or `.yaml`).
* Run **`cfn-docs`** on each template.
* Write the output to a new file with `.README.md` appended to the original filename.

---

### Python Script: `generate_cfn_docs.py`

```python
import os
import subprocess

def generate_docs_for_directory(directory):
    # Loop through all files in the given directory
    for filename in os.listdir(directory):
        if filename.endswith((".yml", ".yaml", ".json")):  # support yaml/json templates
            template_path = os.path.join(directory, filename)
            output_path = os.path.join(directory, f"{filename}.README.md")

            print(f"Generating docs for: {template_path}")
            try:
                with open(output_path, "w") as outfile:
                    subprocess.run(
                        ["cfn-docs", template_path],
                        stdout=outfile,
                        stderr=subprocess.PIPE,
                        check=True,
                        text=True
                    )
                print(f"  -> Created {output_path}")
            except subprocess.CalledProcessError as e:
                print(f"Error generating docs for {template_path}: {e.stderr}")

if __name__ == "__main__":
    directory = "."  # current directory
    generate_docs_for_directory(directory)
```

---

### How to Use

1. Install `cfn-docs`:

   ```bash
   pip install cloudformation-docs
   ```
2. Save the script above as `generate_cfn_docs.py`.
3. Run it from the directory where your templates live:

   ```bash
   python3 generate_cfn_docs.py
   ```

---

### Example

If you have:

```
env-abc-rds-replicas.yml
env-xyz-vpc.yaml
```

After running, you’ll get:

```
env-abc-rds-replicas.yml
env-abc-rds-replicas.yml.README.md
env-xyz-vpc.yaml
env-xyz-vpc.yaml.README.md
```


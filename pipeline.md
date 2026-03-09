# Basic Design

## 

1. Start a pipeline manually from GitLab.
2. Enter variables:

   * target host (IP or FQDN)
   * target username
3. First job runs `faillock` in check mode and shows current status.
4. Second job is manual and runs the unlock.
5. Both jobs should target only the one host passed into the pipeline.

Also, your command should be:

```bash
faillock --user <username>
faillock --reset --user <username>
```

Not `faillock - reset —user`, which looks like a typo/mixed dash issue.

Here’s a solid simple version.

`gitlab-ci.yml`

```yaml
stages:
  - validate
  - check
  - unlock

variables:
  ANSIBLE_HOST_KEY_CHECKING: "False"
  PY_COLORS: "1"
  TARGET_HOST:
    value: ""
    description: "Target server IP or FQDN"
  TARGET_USER:
    value: ""
    description: "Username to check/unlock"

default:
  image: python:3.12

before_script:
  - python -V
  - pip install --no-cache-dir ansible
  - mkdir -p ~/.ssh
  # Optional: if using a GitLab protected variable for SSH private key
  - |
    if [ -n "$ANSIBLE_SSH_PRIVATE_KEY" ]; then
      echo "$ANSIBLE_SSH_PRIVATE_KEY" | tr -d '\r' > ~/.ssh/id_rsa
      chmod 600 ~/.ssh/id_rsa
    fi
  - ansible --version

validate_input:
  stage: validate
  script:
    - test -n "$TARGET_HOST" || (echo "TARGET_HOST is required" && exit 1)
    - test -n "$TARGET_USER" || (echo "TARGET_USER is required" && exit 1)
    - echo "TARGET_HOST=$TARGET_HOST"
    - echo "TARGET_USER=$TARGET_USER"

check_faillock:
  stage: check
  script:
    - >
      ansible-playbook
      -i "${TARGET_HOST},"
      playbooks/faillock_check.yml
      -e "target_user=${TARGET_USER}"
  needs:
    - validate_input

unlock_faillock:
  stage: unlock
  when: manual
  script:
    - >
      ansible-playbook
      -i "${TARGET_HOST},"
      playbooks/faillock_unlock.yml
      -e "target_user=${TARGET_USER}"
  needs:
    - check_faillock
```

The important trick is this:

```bash
-i "${TARGET_HOST},"
```

That trailing comma makes Ansible treat the single value as an inline inventory host.

Now the playbooks.

`playbooks/faillock_check.yml`

```yaml
---
- name: Check faillock status for a user
  hosts: all
  gather_facts: false
  become: true

  vars:
    target_user: ""

  tasks:
    - name: Validate target_user is provided
      ansible.builtin.assert:
        that:
          - target_user | length > 0
        fail_msg: "target_user variable is required"

    - name: Run faillock status check
      ansible.builtin.command: "faillock --user {{ target_user }}"
      register: faillock_status
      changed_when: false
      failed_when: false

    - name: Show faillock output
      ansible.builtin.debug:
        msg:
          - "Host: {{ inventory_hostname }}"
          - "User: {{ target_user }}"
          - "RC: {{ faillock_status.rc }}"
          - "STDOUT: {{ faillock_status.stdout | default('') }}"
          - "STDERR: {{ faillock_status.stderr | default('') }}"
```

`playbooks/faillock_unlock.yml`

```yaml
---
- name: Reset faillock for a user
  hosts: all
  gather_facts: false
  become: true

  vars:
    target_user: ""

  tasks:
    - name: Validate target_user is provided
      ansible.builtin.assert:
        that:
          - target_user | length > 0
        fail_msg: "target_user variable is required"

    - name: Reset faillock for target user
      ansible.builtin.command: "faillock --reset --user {{ target_user }}"
      register: unlock_result
      changed_when: true

    - name: Show unlock command result
      ansible.builtin.debug:
        msg:
          - "Host: {{ inventory_hostname }}"
          - "User: {{ target_user }}"
          - "RC: {{ unlock_result.rc }}"
          - "STDOUT: {{ unlock_result.stdout | default('') }}"
          - "STDERR: {{ unlock_result.stderr | default('') }}"

    - name: Verify faillock status after reset
      ansible.builtin.command: "faillock --user {{ target_user }}"
      register: verify_status
      changed_when: false
      failed_when: false

    - name: Show post-reset status
      ansible.builtin.debug:
        msg:
          - "Post-reset status for {{ target_user }}"
          - "RC: {{ verify_status.rc }}"
          - "STDOUT: {{ verify_status.stdout | default('') }}"
          - "STDERR: {{ verify_status.stderr | default('') }}"
```

A few important implementation notes:

### 1. `become: true` is probably required

`faillock` generally needs elevated privileges, so your Ansible connection user must be allowed to sudo on the target servers.

### 2. SSH access must already work

Your GitLab runner must be able to SSH to the target server:

* network path open
* SSH key available
* correct remote user configured

If your runner connects with a non-default user, add this to the playbooks or pass it in:

```yaml
remote_user: ansible
```

Or pass it as another pipeline variable:

```yaml
TARGET_SSH_USER
```

and run:

```bash
ansible-playbook -u "$TARGET_SSH_USER" ...
```

### 3. Consider adding a host allowlist

From a security standpoint, letting someone type any IP/FQDN into a pipeline can be risky. In a regulated or enterprise shop, I would strongly prefer one of these:

* require the host to already exist in approved inventory
* validate it belongs to an approved domain
* restrict to a specific subnet or naming pattern

For example, cheap validation in the pipeline:

```yaml
validate_input:
  stage: validate
  script:
    - test -n "$TARGET_HOST" || (echo "TARGET_HOST is required" && exit 1)
    - test -n "$TARGET_USER" || (echo "TARGET_USER is required" && exit 1)
    - echo "$TARGET_HOST" | grep -Eq '^[a-zA-Z0-9._-]+$' || (echo "Invalid TARGET_HOST" && exit 1)
    - echo "$TARGET_USER" | grep -Eq '^[a-z_][a-z0-9_-]*[$]?$' || (echo "Invalid TARGET_USER" && exit 1)
```

That is not perfect security, but it is better than nothing.

### 4. Prefer `command` over `shell`

You are not using shell features here, so `ansible.builtin.command` is the right choice.

### 5. Manual unlock is exactly the right call

I agree with your workflow:

* auto run status check
* manual approval for reset

That gives you a lightweight control point and audit trail.

### 6. Nice improvement: environment name in GitLab

You could make the job output more obvious by echoing:

```bash
echo "Checking faillock for user '$TARGET_USER' on host '$TARGET_HOST'"
```

That helps when someone reviews old pipeline runs.

My opinion: keep this as simple as possible. Do not over-engineer it into roles, dynamic inventory, or templates unless your team plans to expand it into a broader “remote user remediation” workflow. For one command on one host, a tiny playbook and two jobs is the right design.

Here’s the minimum repo structure I’d use:

```text
.
├── .gitlab-ci.yml
└── playbooks
    ├── faillock_check.yml
    └── faillock_unlock.yml
```

If you want, I can next turn this into a more production-ready version with:

* SSH user variable
* inventory validation
* protected branch rules
* optional before/after audit logging
* cleaner GitLab pipeline UI descriptions


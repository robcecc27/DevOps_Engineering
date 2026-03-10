Yes — the files that need to change for the new case-insensitive username handling are:

* `.gitlab/ci/faillock-jobs.yml`
* `playbooks/faillock_check.yml`
* `playbooks/faillock_unlock.yml`

And if your pipeline input dropdown still says `stage`, then `.gitlab-ci.yml` also needs that changed to `gss`.

Your `ci/session_map.sh` only needs a change if it still contains `stage` instead of `gss`.

Below is the updated full set.

---

## 1) `.gitlab-ci.yml`

Only needed if your input list still says `stage`.

```yaml
spec:
  inputs:
    session_name:
      type: string
      default: "nonprod"
      options:
        - "nonprod"
        - "gss"
        - "prod"
      description: "AWS session/environment. AWS account is derived automatically."

    target_host:
      type: string
      default: ""
      regex: '^[A-Za-z0-9._-]+$'
      description: "Server IP or FQDN. Will be converted to lowercase."

    target_user:
      type: string
      default: ""
      description: "Username spelling to search for. Case does not need to match exactly."

---
include:
  - local: '/.gitlab/ci/faillock-jobs.yml'
    inputs:
      session_name: $[[ inputs.session_name ]]
      target_host: $[[ inputs.target_host ]]
      target_user: $[[ inputs.target_user ]]
```

Since you now need flexible username entry because of case inconsistency, I would drop the common/custom split and just use one free-text `target_user` input. That is simpler and more reliable for this workflow.

---

## 2) `.gitlab/ci/faillock-jobs.yml`

```yaml
spec:
  inputs:
    session_name:
      type: string
    target_host:
      type: string
    target_user:
      type: string

---
stages:
  - validate
  - check
  - unlock

default:
  image: tools-image:latest

validate_input:
  stage: validate
  script:
    - set -eu

    - test -n "$[[ inputs.session_name ]]" || (echo "session_name is required" && exit 1)
    - test -n "$[[ inputs.target_host ]]" || (echo "target_host is required" && exit 1)
    - test -n "$[[ inputs.target_user ]]" || (echo "target_user is required" && exit 1)

    - TARGET_HOST_LC="$(printf '%s' "$[[ inputs.target_host ]]" | tr '[:upper:]' '[:lower:]')"
    - TARGET_USER="$[[ inputs.target_user ]]"

    - AWS_ACCOUNT="$(./ci/session_map.sh "$[[ inputs.session_name ]]")"

    - echo "SESSION_NAME=$[[ inputs.session_name ]]" >> context.env
    - echo "AWS_ACCOUNT=$AWS_ACCOUNT" >> context.env
    - echo "TARGET_HOST=$TARGET_HOST_LC" >> context.env
    - printf 'TARGET_USER=%s\n' "$TARGET_USER" >> context.env

    - echo "Resolved inputs:"
    - echo "  SESSION_NAME=$[[ inputs.session_name ]]"
    - echo "  AWS_ACCOUNT=$AWS_ACCOUNT"
    - echo "  TARGET_HOST=$TARGET_HOST_LC"
    - echo "  TARGET_USER=$TARGET_USER"
    - echo "  Username matching on server will be case-insensitive"

  artifacts:
    reports:
      dotenv: context.env

check_faillock:
  stage: check
  needs:
    - job: validate_input
      artifacts: true
  script:
    - echo "Checking faillock on host=$TARGET_HOST account=$AWS_ACCOUNT session=$SESSION_NAME input_user=$TARGET_USER"
    - >
      ansible-playbook
      -i "${TARGET_HOST},"
      playbooks/faillock_check.yml
      -e "target_user=${TARGET_USER}"

unlock_faillock:
  stage: unlock
  when: manual
  needs:
    - job: validate_input
      artifacts: true
    - job: check_faillock
  script:
    - echo "Unlocking faillock on host=$TARGET_HOST account=$AWS_ACCOUNT session=$SESSION_NAME input_user=$TARGET_USER"
    - >
      ansible-playbook
      -i "${TARGET_HOST},"
      playbooks/faillock_unlock.yml
      -e "target_user=${TARGET_USER}"
```

---

## 3) `playbooks/faillock_check.yml`

```yaml
---
- name: Check faillock status for all matching case variants
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

    - name: Discover matching usernames from server ignoring case
      ansible.builtin.shell: |
        getent passwd | awk -F: -v want="$TARGET_USER" '
          tolower($1) == tolower(want) { print $1 }
        ' | sort -u
      args:
        executable: /bin/bash
      environment:
        TARGET_USER: "{{ target_user }}"
      register: matched_users
      changed_when: false

    - name: Use discovered usernames or fall back to entered value
      ansible.builtin.set_fact:
        effective_users: >-
          {{
            matched_users.stdout_lines
            if (matched_users.stdout_lines | length > 0)
            else [target_user]
          }}

    - name: Show matched usernames
      ansible.builtin.debug:
        msg:
          - "Input username: {{ target_user }}"
          - "Matched usernames on server: {{ effective_users }}"

    - name: Check faillock status for each matched username
      ansible.builtin.command: "faillock --user {{ item }}"
      loop: "{{ effective_users }}"
      register: faillock_checks
      changed_when: false
      failed_when: false

    - name: Show faillock results
      ansible.builtin.debug:
        msg:
          - "User: {{ item.item }}"
          - "RC: {{ item.rc }}"
          - "STDOUT: {{ item.stdout | default('') }}"
          - "STDERR: {{ item.stderr | default('') }}"
      loop: "{{ faillock_checks.results }}"
```

---

## 4) `playbooks/faillock_unlock.yml`

```yaml
---
- name: Reset faillock for all matching case variants
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

    - name: Discover matching usernames from server ignoring case
      ansible.builtin.shell: |
        getent passwd | awk -F: -v want="$TARGET_USER" '
          tolower($1) == tolower(want) { print $1 }
        ' | sort -u
      args:
        executable: /bin/bash
      environment:
        TARGET_USER: "{{ target_user }}"
      register: matched_users
      changed_when: false

    - name: Use discovered usernames or fall back to entered value
      ansible.builtin.set_fact:
        effective_users: >-
          {{
            matched_users.stdout_lines
            if (matched_users.stdout_lines | length > 0)
            else [target_user]
          }}

    - name: Show matched usernames that will be reset
      ansible.builtin.debug:
        msg:
          - "Input username: {{ target_user }}"
          - "Matched usernames to reset: {{ effective_users }}"

    - name: Reset faillock for each matched username
      ansible.builtin.command: "faillock --reset --user {{ item }}"
      loop: "{{ effective_users }}"
      register: unlock_results
      changed_when: true
      failed_when: false

    - name: Show unlock results
      ansible.builtin.debug:
        msg:
          - "User: {{ item.item }}"
          - "RC: {{ item.rc }}"
          - "STDOUT: {{ item.stdout | default('') }}"
          - "STDERR: {{ item.stderr | default('') }}"
      loop: "{{ unlock_results.results }}"

    - name: Verify faillock status after reset
      ansible.builtin.command: "faillock --user {{ item }}"
      loop: "{{ effective_users }}"
      register: verify_results
      changed_when: false
      failed_when: false

    - name: Show post-reset verification
      ansible.builtin.debug:
        msg:
          - "User: {{ item.item }}"
          - "RC: {{ item.rc }}"
          - "STDOUT: {{ item.stdout | default('') }}"
          - "STDERR: {{ item.stderr | default('') }}"
      loop: "{{ verify_results.results }}"
```

---

## 5) `ci/session_map.sh`

Only needed if this file still says `stage`.

```bash
#!/usr/bin/env bash
set -eu

SESSION_NAME="${1:-}"

case "$SESSION_NAME" in
  nonprod) echo "12345124512" ;;
  prod)    echo "543215432112" ;;
  gss)     echo "098760987612" ;;
  *)
    echo "Invalid session_name: $SESSION_NAME" >&2
    exit 1
    ;;
esac
```

---

## What changed from the earlier version

The main functional change is this:

* `target_user` is now always free text
* the playbooks search the target server with `getent passwd`
* matching is case-insensitive
* all matched case variants are checked
* all matched case variants are reset

That is the right design for the AD inconsistency you described.

## My recommendation

I would keep the pipeline UI to only these 3 inputs:

* `session_name`
* `target_host`
* `target_user`

That keeps it fast for INC handling and avoids overcomplicating a simple unlock workflow.




**pipeline-level inputs must live in the main `.gitlab-ci.yml` file.** GitLab does not let you define the Run Pipeline page inputs in an included file. Inputs are also scoped to the file they are defined in, so if you split jobs into another file, you pass values into that file with `include:inputs`. ([GitLab Docs][1])

So the clean pattern is:

* keep the **Run Pipeline inputs** in `.gitlab-ci.yml`
* move the **jobs** to an included file
* move the **session-to-account mapping** to a small shell file
* optionally use a **hybrid user selector**:

  * dropdown for common accounts
  * custom text input for anything else

GitLab inputs support typed values, descriptions, regex validation, and option lists. GitLab also added `spec:inputs:rules` with `default: null` so an input can require a user-entered value when a condition matches. That free-entry pattern is only available in newer GitLab versions. ([GitLab Docs][2])

My opinion: for this repo, the best balance is:

* `session_name` as a dropdown
* `target_host` as free text
* `user_mode` as dropdown: `common` or `custom`
* `common_user` as dropdown
* `custom_user` as free text only when needed


## Recommended repo layout

```text
.
├── .gitlab-ci.yml
├── .gitlab
│   └── ci
│       └── faillock-jobs.yml
├── ci
│   └── session_map.sh
└── playbooks
    ├── faillock_check.yml
    └── faillock_unlock.yml
```

---

## 1) Main `.gitlab-ci.yml`

This file owns the pipeline inputs and passes them to the included jobs file.

```yaml
spec:
  inputs:
    session_name:
      type: string
      default: "nonprod"
      options:
        - "nonprod"
        - "stage"
        - "prod"
      description: "AWS session/environment. AWS account is derived automatically."

    target_host:
      type: string
      default: ""
      regex: '^[A-Za-z0-9._-]+$'
      description: "Server IP or FQDN. Will be converted to lowercase."

    user_mode:
      type: string
      default: "common"
      options:
        - "common"
        - "custom"
      description: "Choose a common user from the list, or enter a custom username."

    common_user:
      type: string
      description: "Common unlock target. Used only when user_mode=common."
      rules:
        - if: $[[ inputs.user_mode ]] == 'common'
          options:
            - "oracle"
            - "acapic"
            - "svc_batch"
            - "svc_app"
            - "svc_monitor"
          default: "oracle"
        - default: ""

    custom_user:
      type: string
      description: "Custom username. Case is preserved exactly as entered."
      rules:
        - if: $[[ inputs.user_mode ]] == 'custom'
          default: null
        - default: ""

---
include:
  - local: '/.gitlab/ci/faillock-jobs.yml'
    inputs:
      session_name: $[[ inputs.session_name ]]
      target_host: $[[ inputs.target_host ]]
      user_mode: $[[ inputs.user_mode ]]
      common_user: $[[ inputs.common_user ]]
      custom_user: $[[ inputs.custom_user ]]
```

A few notes:

* `target_host` is validated and later lowercased.
* `custom_user` preserves case because we do not transform it.
* `common_user` gives you a dropdown for the regular unlock accounts.
* `custom_user` only becomes required when `user_mode=custom`.

If your GitLab version is older and does not support the `default: null` rule behavior, use a single free-text `target_user` input instead. The conditional free-entry pattern is documented as introduced in GitLab 18.9. ([GitLab Docs][2])

---

## 2) Included jobs file: `/.gitlab/ci/faillock-jobs.yml`

```yaml
spec:
  inputs:
    session_name:
      type: string
    target_host:
      type: string
    user_mode:
      type: string
    common_user:
      type: string
      default: ""
    custom_user:
      type: string
      default: ""

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

    - TARGET_HOST_LC="$(printf '%s' "$[[ inputs.target_host ]]" | tr '[:upper:]' '[:lower:]')"

    - |
      if [ "$[[ inputs.user_mode ]]" = "custom" ]; then
        TARGET_USER="$[[ inputs.custom_user ]]"
      else
        TARGET_USER="$[[ inputs.common_user ]]"
      fi

    - test -n "$TARGET_USER" || (echo "Resolved target user is empty" && exit 1)

    - AWS_ACCOUNT="$(./ci/session_map.sh "$[[ inputs.session_name ]]")"

    - echo "SESSION_NAME=$[[ inputs.session_name ]]" >> context.env
    - echo "AWS_ACCOUNT=$AWS_ACCOUNT" >> context.env
    - echo "TARGET_HOST=$TARGET_HOST_LC" >> context.env
    - printf 'TARGET_USER=%s\n' "$TARGET_USER" >> context.env

    - echo "Resolved inputs:"
    - echo "  SESSION_NAME=$[[ inputs.session_name ]]"
    - echo "  AWS_ACCOUNT=$AWS_ACCOUNT"
    - echo "  TARGET_HOST=$TARGET_HOST_LC"
    - echo "  TARGET_USER preserved exactly as entered/selected"

  artifacts:
    reports:
      dotenv: context.env

check_faillock:
  stage: check
  needs:
    - job: validate_input
      artifacts: true
  script:
    - echo "Checking faillock on host=$TARGET_HOST account=$AWS_ACCOUNT session=$SESSION_NAME user=$TARGET_USER"
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
    - echo "Unlocking faillock on host=$TARGET_HOST account=$AWS_ACCOUNT session=$SESSION_NAME user=$TARGET_USER"
    - >
      ansible-playbook
      -i "${TARGET_HOST},"
      playbooks/faillock_unlock.yml
      -e "target_user=${TARGET_USER}"
```

---

## 3) Session mapping file: `ci/session_map.sh`

```bash
#!/usr/bin/env bash
set -eu

SESSION_NAME="${1:-}"

case "$SESSION_NAME" in
  nonprod) echo "12345124512" ;;
  prod)    echo "543215432112" ;;
  stage)   echo "098760987612" ;;
  *)
    echo "Invalid session_name: $SESSION_NAME" >&2
    exit 1
    ;;
esac
```

Make it executable:

```bash
chmod 755 ci/session_map.sh
```

---

## Why this is the right split

This gives you separation without fighting GitLab:

* `.gitlab-ci.yml`

  * owns the pipeline UI inputs
* `faillock-jobs.yml`

  * owns the actual pipeline jobs
* `session_map.sh`

  * owns the environment/account mapping

That means changing an AWS account mapping does **not** require editing the job logic.

---

## About “one field that is either dropdown or custom”

GitLab does not give you a perfect “combo box” input the way a web form would. The practical solution is the two-field pattern above:

* one selector to choose common vs custom
* one dropdown for common values
* one text field for custom values

That is the closest clean implementation with inputs.

My practical recommendation:

* if your team mostly unlocks the same 10–15 accounts, use the hybrid pattern above
* if people often type one-off usernames, drop the dropdown entirely and use one free-text `target_user` input

For this specific repo, I think the hybrid version is worth it only if those same service accounts show up constantly.

If you want, I’ll turn this into a final copy-paste set with your actual common usernames filled in and trimmed down to the exact YAML you can commit.

[1]: https://docs.gitlab.com/ci/inputs/?utm_source=chatgpt.com "CI/CD inputs"
[2]: https://docs.gitlab.com/ci/inputs/ "CI/CD inputs | GitLab Docs"


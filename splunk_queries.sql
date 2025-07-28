index=swim sourcetype=springboot:api "ASSIGNED_USERNAME"
| rex "\[ASSIGNED_USERNAME\]\s*:\s*\[VARCHAR\]\)\s*-\s*\[(?<username>[^\]]+)\]"
| stats count by username


Explanation:
rex: tells Splunk to extract data using a regular expression.

(?<username>[^\]]+): creates a field named username by capturing any characters up to the closing ].

stats count by username: gives you a list of all usernames and how often each appears.

Optional: Just get distinct usernames

index=swim sourcetype=springboot:api "ASSIGNED_USERNAME"
| rex "\[ASSIGNED_USERNAME\]\s*:\s*\[VARCHAR\]\)\s*-\s*\[(?<username>[^\]]+)\]"
| dedup username
| table username


## Got it — in Splunk Dashboard Studio you’re looking at **JSON** instead of the old Simple XML, but the search query itself stays the same regardless of format.


```spl
index=swat sourcetype="springboot:api" accountid=123456789012 ("ERROR" OR "FAILURE")
| spath
| eval raw=_raw
| eval level=coalesce(level, if(match(raw,"ERROR"),"ERROR", if(match(raw,"FAILURE"),"FAILURE",null())))
| rex field=raw max_match=1 "status(?:Code)?[=:\"](?<status>\d{3})"
| rex field=raw max_match=1 "path[=:\"](?<path>\/[^\"\s]+)"
| rex field=raw max_match=1 "method[=:\"](?<method>[A-Z]{3,7})"
| rex field=raw max_match=1 "exception[=:\"](?<exception>[A-Za-z0-9_.\$]+)"
| rex field=raw max_match=1 "(?:traceId|trace_id|X-Trace-Id)[=:\"](?<traceId>[a-f0-9-]{8,})"
| eval message=coalesce(message, msg, raw)
| where level="ERROR" OR like(upper(message), "%FAILURE%")
| table _time level status method path exception traceId message
| sort - _time
```

**What it does:**

* Filters to just the chosen `accountid` and only ERROR/FAILURE logs.
* Parses JSON fields if present (`spath`), then falls back to regex extraction for common fields.
* Shows a clean table with:

  * Timestamp
  * Log level
  * HTTP status
  * HTTP method
  * Endpoint path
  * Exception name
  * Trace ID
  * Message
* Sorted newest first.

If you drop that into a Dashboard Studio panel, just paste it as the **data source query** and choose a **Table** visualization for a clean view.

---

Do you want me to also give you a **companion query** that shows a time-chart of error counts so you can have both the table and a visual trend in your dashboard? That way you get quick insights plus detail when you need to drill in.
 improved search query for your Spring Boot API errors, cleaned up and more useful than just `table _raw`:

```spl
index=swat sourcetype="springboot:api" accountid=123456789012 ("ERROR" OR "FAILURE")
| spath
| eval raw=_raw
| eval level=coalesce(level, if(match(raw,"ERROR"),"ERROR", if(match(raw,"FAILURE"),"FAILURE",null())))
| rex field=raw max_match=1 "status(?:Code)?[=:\"](?<status>\d{3})"
| rex field=raw max_match=1 "path[=:\"](?<path>\/[^\"\s]+)"
| rex field=raw max_match=1 "method[=:\"](?<method>[A-Z]{3,7})"
| rex field=raw max_match=1 "exception[=:\"](?<exception>[A-Za-z0-9_.\$]+)"
| rex field=raw max_match=1 "(?:traceId|trace_id|X-Trace-Id)[=:\"](?<traceId>[a-f0-9-]{8,})"
| eval message=coalesce(message, msg, raw)
| where level="ERROR" OR like(upper(message), "%FAILURE%")
| table _time level status method path exception traceId message
| sort - _time
```

**What it does:**

* Filters to just the chosen `accountid` and only ERROR/FAILURE logs.
* Parses JSON fields if present (`spath`), then falls back to regex extraction for common fields.
* Shows a clean table with:

  * Timestamp
  * Log level
  * HTTP status
  * HTTP method
  * Endpoint path
  * Exception name
  * Trace ID
  * Message
* Sorted newest first.

If you drop that into a Dashboard Studio panel, just paste it as the **data source query** and choose a **Table** visualization for a clean view.

---
Option A: X‑axis = ERROR/FAILURE, series = accountid (clustered bars)
spl
Copy
Edit
index=swat sourcetype="springboot:api" ("ERROR" OR "FAILURE")
| spath
| eval level=coalesce(upper(level), if(like(upper(_raw),"%FAILURE%"),"FAILURE", if(like(upper(_raw),"%ERROR%"),"ERROR", null())))
| eval accountid=coalesce(accountid,"(none)")
| search level=ERROR OR level=FAILURE
| chart count over level by accountid
In the viz: choose Column (or Bar) → Stack Mode: off for clustered, or Stacked if you prefer one bar per level.

Option B: X‑axis = accountid, series = ERROR/FAILURE
spl
Copy
Edit
index=swat sourcetype="springboot:api" ("ERROR" OR "FAILURE")
| spath
| eval level=coalesce(upper(level), if(like(upper(_raw),"%FAILURE%"),"FAILURE","ERROR"))
| eval accountid=coalesce(accountid,"(none)")
| chart count over accountid by level
Notes
Keep the transforming command last (chart or stats). If you add table after it, the chart will break.

If you want totals/labels:

spl
Copy
Edit
... | chart count over level by accountid | rename count AS events
If some events have neither term, they’ll be dropped by the search level=... line; that’s intentional here.

index=swat sourcetype="springboot:api" "Cognito UserId::"
| rex "Cognito UserId::\"(?<username>[^\"]+)\""
| rex "(?<epoch_time>\d+\.\d+)"
| eval login_time=strftime(epoch_time, "%Y-%m-%d %H:%M:%S")
| table login_time username
| sort - login_time

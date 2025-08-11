Got it. You’ve already got the right building blocks—your JSON has a `diskIO` array, so the trick is: parse JSON → expand the array → pull read/write IOPS & throughput → chart it. Below are drop‑in SPL snippets you can use. They’re resilient to a few key typos I noticed (`readThroughtput`, capitalization).

### Base search (parameterized by account)

Use this as a **base** for panels. Replace `123456789012` or wire it to a dashboard token like `$accountid$`.

```spl
index=abc sourcetype="aurora:postgresql"
| eval accountid=lower(accountid)
| search accountid=123456789012
| spath path=diskIO output=diskIO
| mvexpand diskIO
| spath input=diskIO
/* Normalize fields (handle alt spellings/keys) */
| eval read_iops = coalesce('readIOsPS','readIOPS','readIosPS',0)+0
| eval write_iops = coalesce('writeIOsPS','writeIOPS','writeIosPS',0)+0
| eval read_kbps = coalesce('readKbPS','readThroughput','readThroughtput',0)+0
| eval write_kbps = coalesce('writeKbPS','writeThroughput',0)+0
| eval total_iops = read_iops + write_iops
| eval total_kbps = read_kbps + write_kbps
```

> If you’re building a dashboard, swap the hardcoded account for a token:
> `| search accountid=$accountid$` (and set a default like `123456789012`)

---

### Panel 1 — IOPS over time (by instance)

Good for spotting spikes and read vs write balance.

```spl
<base search above>
| timechart span=5m avg(read_iops) AS read_iops avg(write_iops) AS write_iops avg(total_iops) AS total_iops BY instanceID
```

* Tip: In the viz, enable legend + use Trellis by `instanceID` if lines get busy.

---

### Panel 2 — Throughput (KB/s) over time (account-level)

Shows network in/out trend for the DB fleet in that account.

```spl
<base search above>
| timechart span=5m avg(read_kbps) AS read_kbps avg(write_kbps) AS write_kbps avg(total_kbps) AS total_kbps
```

---

### Panel 3 — Current IOPS (single-value by instance)

Latest 5‑minute average per instance with a sparkline.

```spl
<base search above>
| timechart span=5m avg(total_iops) AS total_iops BY instanceID
| tail 1
| transpose header_field=instanceID
```

(Configure viz: Single Value, show sparkline, range coloring.)

---

### Optional: by cluster (if you have a cluster field)

If your events include something like `dbClusterIdentifier` (name varies), you can aggregate by cluster:

```spl
<base search above>
| timechart span=5m avg(total_iops) BY dbClusterIdentifier
```

---

### Notes & gotchas

* Your sample has minor typos (`readThroughtput`, capitalization, etc.). The `coalesce(...)` lines above make the search tolerant.
* If `diskIO` sometimes contains heterogeneous objects (like your second object with `device`), the `mvexpand` approach still works—fields that don’t exist just resolve to 0 via `+0`.
* If you want to **filter writer vs reader** instances, add a predicate if there’s a role field (e.g., `| search role=writer`) or pattern-match `instanceID`.

Want me to wrap this into a simple Splunk Dashboard XML/JSON with an `$accountid$` dropdown so you can paste-and-go?

Awesome — here’s a paste‑and‑go **Simple XML** dashboard with an `$accountid$` text input, time range picker, and three panels (IOPS by instance, Throughput account‑level, and Current IOPS tiles). It uses a **base search** + post‑process, and it’s tolerant of the field name typos you showed.

```xml
<dashboard>
  <label>Aurora IOPS & Throughput</label>
  <description>IOPS and throughput from aurora:postgresql logs (tokenized by AWS account ID).</description>

  <fieldset submitButton="false">
    <input type="text" token="accountid" searchWhenChanged="true">
      <label>AWS Account ID</label>
      <default>123456789012</default>
    </input>
    <input type="dropdown" token="span" searchWhenChanged="true">
      <label>Time Bucket</label>
      <choice value="1m">1m</choice>
      <choice value="5m">5m</choice>
      <choice value="15m">15m</choice>
      <choice value="30m">30m</choice>
      <default>5m</default>
    </input>
    <input type="time" token="time_range"/>
  </fieldset>

  <!-- Base search: parse JSON, expand diskIO array, normalize fields -->
  <row>
    <panel depends="$accountid$">
      <title>Base (hidden)</title>
      <chart>
        <search id="base">
          <query>
            index=abc sourcetype="aurora:postgresql"
            | eval accountid=lower(accountid)
            | search accountid=$accountid$
            | spath path=diskIO output=diskIO
            | mvexpand diskIO
            | spath input=diskIO
            | eval read_iops = coalesce('readIOsPS','readIOPS','readIosPS',0)+0
            | eval write_iops = coalesce('writeIOsPS','writeIOPS','writeIosPS',0)+0
            | eval read_kbps = coalesce('readKbPS','readThroughput','readThroughtput',0)+0
            | eval write_kbps = coalesce('writeKbPS','writeThroughput',0)+0
            | eval total_iops = read_iops + write_iops
            | eval total_kbps = read_kbps + write_kbps
          </query>
          <earliest>$time_range.earliest$</earliest>
          <latest>$time_range.latest$</latest>
        </search>
        <option name="charting.chart">line</option>
        <option name="height">1</option>
      </chart>
    </panel>
  </row>

  <row>
    <panel>
      <title>IOPS over time (by instance)</title>
      <chart>
        <search base="base">
          <query>
            | timechart span=$span$ avg(read_iops) AS read_iops avg(write_iops) AS write_iops avg(total_iops) AS total_iops BY instanceID
          </query>
          <earliest>$time_range.earliest$</earliest>
          <latest>$time_range.latest$</latest>
        </search>
        <option name="charting.chart">line</option>
        <option name="charting.legend.placement">right</option>
        <option name="trellis.enabled">0</option>
      </chart>
    </panel>

    <panel>
      <title>Throughput (KB/s) over time (account-level)</title>
      <chart>
        <search base="base">
          <query>
            | timechart span=$span$ avg(read_kbps) AS read_kbps avg(write_kbps) AS write_kbps avg(total_kbps) AS total_kbps
          </query>
          <earliest>$time_range.earliest$</earliest>
          <latest>$time_range.latest$</latest>
        </search>
        <option name="charting.chart">line</option>
        <option name="charting.legend.placement">right</option>
      </chart>
    </panel>
  </row>

  <row>
    <panel>
      <title>Current Total IOPS (tiles by instance)</title>
      <chart>
        <search base="base">
          <query>
            | bin _time span=$span$
            | stats avg(total_iops) AS total_iops BY instanceID _time
            | stats latest(total_iops) AS total_iops BY instanceID
            | sort instanceID
          </query>
          <earliest>$time_range.earliest$</earliest>
          <latest>$time_range.latest$</latest>
        </search>
        <option name="charting.chart">singlevalue</option>
        <option name="trellis.enabled">1</option>
        <option name="trellis.splitBy">instanceID</option>
        <option name="charting.singlevalue.afterLabel">IOPS</option>
        <option name="charting.singlevalue.showSparkline">true</option>
      </chart>
    </panel>
  </row>

</dashboard>
```

**How to use**

1. In Splunk, create a new Classic (Simple XML) dashboard and paste this XML.
2. Set the default account ID (or just type one in the input).
3. Adjust `index`/`sourcetype` names if yours differ.
4. If you want to filter writers/readers, add something like `| search role=writer` to the base query.

Want a **Dashboard Studio** JSON version too (nicer visuals), or a dropdown sourced from live `accountid` values found in your data instead of a free‑text box?


import json, math, re, sys, urllib.request
from datetime import datetime, timezone

BASE = "https://www.deribit.com/api/v2/public/"
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
NAME = re.compile(r"^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-([\d.d]+)-([CP])$")

def get(path, **p):
    url = BASE + path + "?" + "&".join(f"{k}={v}" for k, v in p.items())
    req = urllib.request.Request(url, headers={"User-Agent": "gamma-detrite/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["result"]

def parse(n):
    m = NAME.match(n)
    if not m or m.group(2) not in MON:
        return None
    d, mo, yy, k, cp = m.groups()
    e = datetime(2000 + int(yy), MON[mo], int(d), 8, 0, tzinfo=timezone.utc)
    return e, float(k.replace("d", ".")), cp

def gamma(F, K, s, T):
    d1 = (math.log(F / K) + 0.5 * s * s * T) / (s * math.sqrt(T))
    return math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (F * s * math.sqrt(T))

def compute(rows_in, spot, now, cols=10, rows=21):
    cell, po, co = {}, 0.0, 0.0
    for s in rows_in:
        p = parse(s.get("instrument_name", ""))
        if not p:
            continue
        e, K, cp = p
        oi = s.get("open_interest") or 0
        iv = (s.get("mark_iv") or 0) / 100.0
        F = s.get("underlying_price") or spot
        T = (e - now).total_seconds() / (365 * 86400)
        if oi <= 0 or iv <= 0 or T <= 0:
            continue
        g = gamma(F, K, iv, T) * oi * spot * spot * 0.01
        g = g if cp == "C" else -g
        cell[(K, e)] = cell.get((K, e), 0.0) + g
        if cp == "C":
            co += oi
        else:
            po += oi
    exps = sorted({e for (_, e) in cell})[:cols]
    near = sorted({k for (k, e) in cell if e in exps}, key=lambda k: abs(k - spot))[:rows]
    ks = sorted(near)
    return {
        "spot": round(spot, 2),
        "asof": now.strftime("%Y-%m-%d %H:%M UTC"),
        "exps": [f"{(e.date() - now.date()).days}d" for e in exps],
        "strikes": ks,
        "m": [[round(cell.get((k, e), 0.0) / 1e6, 4) for e in exps] for k in ks],
        "pc": round(po / co, 2) if co else None,
    }

if __name__ == "__main__":
    now = datetime.now(timezone.utc)
    out = {}
    for cur in ("BTC", "ETH"):
        spot = get("get_index_price", index_name=cur.lower() + "_usd")["index_price"]
        chain = get("get_book_summary_by_currency", currency=cur, kind="option")
        out[cur] = compute(chain, spot, now)
        print(cur, "spot", out[cur]["spot"], "expiries", out[cur]["exps"], file=sys.stderr)
    with open("gamma-data.json", "w") as f:
        json.dump(out, f)
    print("saved gamma-data.json")

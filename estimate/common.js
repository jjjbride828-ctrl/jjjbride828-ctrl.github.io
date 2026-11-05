/* 인테리어 견적 앱 공통 모듈 */
const IE = (() => {
  // 구독코드 검증용 공개키 (발급용 비공개키는 운영자만 보관)
  const PUBKEY = { kty: "EC", crv: "P-256", x: "E2m-ahdEfhxgz_mMvp05HFCKgbcsuPqVrNx-VTe9WPM", y: "SQ51yCZrU0WR0O1w7H9_U8tHld4KcP-kRykF66T1MPY" };

  // 아래 단가와 계수는 화면 예시용 기본값입니다. 실제 시세가 아니며 대표님 단가로 바꿔서 사용합니다.
  const DEFAULT_TYPES = [
    { id: "apt", name: "아파트", k: 1.0 },
    { id: "villa", name: "빌라·다세대", k: 1.05 },
    { id: "house", name: "단독주택", k: 1.15 },
    { id: "officetel", name: "오피스텔", k: 0.95 },
    { id: "store", name: "상가·매장", k: 1.1 },
    { id: "office", name: "사무실", k: 0.95 }
  ];
  const DEFAULT_ITEMS = [
    { id: "demo", name: "철거", desc: "기존 마감재 철거", unit: "py", price: 120000, def: true },
    { id: "plumb", name: "설비·배관", desc: "급배수, 방수 보강", unit: "py", price: 60000, def: false },
    { id: "elec", name: "전기·조명", desc: "배선, 스위치, 조명 교체", unit: "py", price: 100000, def: true },
    { id: "wood", name: "목공", desc: "천장, 몰딩, 문틀", unit: "py", price: 250000, def: true },
    { id: "window", name: "창호(샷시)", desc: "창호 교체", unit: "py", price: 200000, def: false },
    { id: "tile", name: "타일", desc: "현관, 발코니 타일", unit: "py", price: 60000, def: false },
    { id: "floor", name: "바닥", desc: "마루 또는 장판", unit: "py", price: 120000, def: true },
    { id: "paper", name: "도배", desc: "벽, 천장 도배", unit: "py", price: 50000, def: true },
    { id: "paint", name: "도장·필름", desc: "문, 몰딩 필름 또는 도장", unit: "py", price: 60000, def: false },
    { id: "bath", name: "욕실", desc: "욕실 1개 기준 전체 시공", unit: "ea", per: "bath", price: 4000000, def: true },
    { id: "kitchen", name: "주방가구", desc: "싱크대, 상판 교체", unit: "ea", price: 4500000, def: true },
    { id: "closet", name: "붙박이장·수납", desc: "맞춤 수납가구", unit: "ea", price: 2500000, def: false },
    { id: "clean", name: "폐기물·준공청소", desc: "폐기물 처리, 입주 청소", unit: "py", price: 30000, def: true }
  ];

  const PY = 3.3058;
  const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
  const man = n => {
    const m = Math.round(n / 10000);
    return m >= 10000 ? (Math.floor(m / 10000) + "억 " + (m % 10000 ? (m % 10000).toLocaleString("ko-KR") + "만" : "")).trim() + "원" : m.toLocaleString("ko-KR") + "만원";
  };
  const round = (n, u = 1000) => Math.round(n / u) * u;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function korean(num) {
    num = Math.floor(num);
    if (!num) return "영";
    const d = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"], u = ["", "십", "백", "천"], b = ["", "만", "억", "조"];
    let out = "", g = 0;
    while (num > 0) {
      const part = num % 10000;
      if (part) {
        let s = "", p = part, i = 0;
        while (p > 0) { const x = p % 10; if (x) s = d[x] + u[i] + s; p = Math.floor(p / 10); i++; }
        out = s + b[g] + out;
      }
      num = Math.floor(num / 10000); g++;
    }
    return out;
  }

  function qtyOf(item, py, baths) {
    if (item.unit === "py") return py;
    if (item.per === "bath") return baths;
    return 1;
  }
  const unitLabel = it => it.unit === "py" ? "평" : (it.per === "bath" ? "개" : "식");

  // base64url <-> bytes/JSON
  const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const encodeObj = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const decodeObj = s => JSON.parse(new TextDecoder().decode(unb64u(s)));

  // 구독코드: base64url(JSON{n:업체명,e:만료일 YYYY-MM-DD,i:발급번호}).base64url(서명)
  async function verifyLicense(code) {
    try {
      code = (code || "").trim().replace(/\s+/g, "");
      const [p, sig] = code.split(".");
      if (!p || !sig) return { ok: false, reason: "코드 형식이 올바르지 않습니다." };
      const key = await crypto.subtle.importKey("jwk", PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(sig), new TextEncoder().encode(p));
      if (!valid) return { ok: false, reason: "등록되지 않은 구독코드입니다." };
      const data = decodeObj(p);
      const end = new Date(data.e + "T23:59:59");
      if (end < new Date()) return { ok: false, expired: true, data, reason: "구독 기간이 " + data.e + "에 끝났습니다." };
      const left = Math.ceil((end - new Date()) / 86400000);
      return { ok: true, data, left };
    } catch (e) {
      return { ok: false, reason: "구독코드를 확인할 수 없습니다." };
    }
  }

  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const clone = o => JSON.parse(JSON.stringify(o));

  return { PUBKEY, DEFAULT_TYPES, DEFAULT_ITEMS, PY, won, man, round, esc, korean, qtyOf, unitLabel, b64u, unb64u, encodeObj, decodeObj, verifyLicense, load, save, clone };
})();

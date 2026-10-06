(() => {
  const DURATION_MS = 60 * 1000;
  const WARN_MS = 10 * 1000;

  const $ = (id) => document.getElementById(id);
  const els = {
    cats: $("cats"), catTag: $("catTag"), topicEn: $("topicEn"), topicTh: $("topicTh"),
    hintToggle: $("hintToggle"), hints: $("hints"),
    timer: $("timer"), ring: $("ring"), time: $("time"), status: $("status"),
    shuffleBtn: $("shuffleBtn"), startBtn: $("startBtn"), resetBtn: $("resetBtn"),
    countText: $("countText"),
  };

  const CIRCUMFERENCE = 2 * Math.PI * Number(els.ring.getAttribute("r"));
  els.ring.style.strokeDasharray = CIRCUMFERENCE;

  // state: "idle" | "running" | "paused" | "done"
  let state = "idle";
  let remainingMs = DURATION_MS;
  let endAt = 0;
  let rafId = 0;
  let category = "all";
  let current = null;
  let recent = [];

  // ---------- หมวดหัวข้อ ----------
  CATEGORIES.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = c.label;
    b.setAttribute("aria-pressed", String(c.id === category));
    b.addEventListener("click", () => {
      category = c.id;
      els.cats.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      shuffle();
    });
    els.cats.appendChild(b);
  });

  // ---------- สุ่มหัวข้อ (ไม่ซ้ำกับ 5 หัวข้อล่าสุด) ----------
  function shuffle() {
    const pool = TOPICS.filter((t) => category === "all" || t.cat === category);
    const fresh = pool.filter((t) => !recent.includes(t));
    const choices = fresh.length ? fresh : pool.filter((t) => t !== current);
    current = choices[Math.floor(Math.random() * choices.length)] || pool[0];
    recent = [current, ...recent].slice(0, 5);
    renderTopic();
    resetTimer();
  }

  function renderTopic() {
    const cat = CATEGORIES.find((c) => c.id === current.cat);
    els.catTag.textContent = cat ? cat.label : "";
    els.topicEn.textContent = current.en;
    els.topicTh.textContent = current.th;
    els.hints.innerHTML = "";
    current.hints.forEach((h) => {
      const li = document.createElement("li");
      li.textContent = h;
      els.hints.appendChild(li);
    });
    els.hints.hidden = true;
    els.hintToggle.hidden = false;
    els.hintToggle.textContent = "💡 ดูคำถามช่วยคิด";
  }

  els.hintToggle.addEventListener("click", () => {
    els.hints.hidden = !els.hints.hidden;
    els.hintToggle.textContent = els.hints.hidden ? "💡 ดูคำถามช่วยคิด" : "🙈 ซ่อนคำถามช่วยคิด";
  });

  // ---------- ตัวจับเวลา ----------
  function format(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function draw() {
    els.time.textContent = format(remainingMs);
    els.ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - remainingMs / DURATION_MS);
    els.timer.classList.toggle("warn", state === "running" && remainingMs <= WARN_MS);
    els.timer.classList.toggle("done", state === "done");
  }

  function tick() {
    remainingMs = Math.max(0, endAt - Date.now());
    draw();
    if (remainingMs === 0) return finish();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (!current) shuffle();
    unlockAudio();
    state = "running";
    endAt = Date.now() + remainingMs;
    requestWakeLock();
    rafId = requestAnimationFrame(tick);
    updateUi();
  }

  function pause() {
    cancelAnimationFrame(rafId);
    remainingMs = Math.max(0, endAt - Date.now());
    state = "paused";
    releaseWakeLock();
    draw();
    updateUi();
  }

  function finish() {
    cancelAnimationFrame(rafId);
    state = "done";
    remainingMs = 0;
    releaseWakeLock();
    beep();
    addPracticeCount();
    draw();
    updateUi();
  }

  function resetTimer() {
    cancelAnimationFrame(rafId);
    state = "idle";
    remainingMs = DURATION_MS;
    releaseWakeLock();
    draw();
    updateUi();
  }

  function updateUi() {
    const labels = {
      idle: ["▶ เริ่มพูด", "พร้อมแล้วกด “เริ่มพูด”"],
      running: ["⏸ หยุดชั่วคราว", "กำลังพูด... พูดต่อไปเรื่อย ๆ ไม่ต้องกลัวผิด"],
      paused: ["▶ พูดต่อ", "หยุดชั่วคราว"],
      done: ["▶ พูดหัวข้อนี้อีกครั้ง", "หมดเวลา! เก่งมาก 🎉 ลองสุ่มหัวข้อใหม่ได้เลย"],
    };
    const [btn, status] = labels[state];
    els.startBtn.textContent = btn;
    els.status.textContent = status;
    els.resetBtn.disabled = state === "idle";
  }

  els.startBtn.addEventListener("click", () => {
    if (state === "running") pause();
    else if (state === "done") { resetTimer(); start(); }
    else start();
  });
  els.resetBtn.addEventListener("click", resetTimer);
  els.shuffleBtn.addEventListener("click", shuffle);

  // ถ้าสลับแอปแล้วกลับมา ให้คำนวณเวลาใหม่ และขอให้หน้าจอไม่ดับอีกครั้ง
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state === "running") {
      requestWakeLock();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    }
  });

  // ---------- เสียงเตือนเมื่อหมดเวลา ----------
  // Safari บน iPad ต้อง "ปลดล็อก" เสียงจากการแตะของผู้ใช้ก่อน จึงสร้าง AudioContext ตอนกดเริ่ม
  let audioCtx = null;
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1046 : 880;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.22);
    });
  }

  // ---------- กันหน้าจอดับระหว่างจับเวลา ----------
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch { /* บางเบราว์เซอร์ไม่รองรับ ไม่เป็นไร */ }
  }
  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // ---------- นับจำนวนครั้งที่ฝึกวันนี้ ----------
  const todayKey = () => {
    const d = new Date();
    return `practice-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  function readCount() {
    try { return Number(localStorage.getItem(todayKey())) || 0; } catch { return 0; }
  }
  function addPracticeCount() {
    const n = readCount() + 1;
    try { localStorage.setItem(todayKey(), String(n)); } catch { /* โหมดส่วนตัว */ }
    renderCount(n);
  }
  function renderCount(n) {
    els.countText.textContent = `วันนี้ฝึกไปแล้ว ${n} ครั้ง`;
  }

  renderCount(readCount());
  shuffle();
})();

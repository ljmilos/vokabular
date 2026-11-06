import { useState, useEffect, useRef, useMemo } from "react";

const SUPABASE_URL = "https://evajlksybjhnqvrykimf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2YWpsa3N5YmpobnF2cnlraW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NzY4NjgsImV4cCI6MjA5NjI1Mjg2OH0.WAdG0kvqXNPtgivfZwPxFDOUnmnEk95rYokK0gSRXa4";

const supabaseAuth = {
  async signUp(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return res.json();
  },
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return res.json();
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
  },
  async getUser(token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
    return res.json();
  }
};

const smartDb = {
  async load(token) {
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
    const [scheduleResponse, historyResponse] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/vocab_srs_schedule?select=word_id,due_at,interval_days,streak,repetitions,last_rating&limit=10000`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/vocab_review_history?select=word_id,rating,reviewed_at&order=reviewed_at.desc&limit=10000`, { headers })
    ]);
    if (!scheduleResponse.ok || !historyResponse.ok) {
      throw new Error("Smart Learning tabela nije dostupna. Prvo pokreni SQL migraciju iz ZIP paketa.");
    }
    return { schedule: await scheduleResponse.json(), history: await historyResponse.json() };
  },
  async rate(token, wordId, rating, requestId) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_vocab_review`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_word_id: String(wordId), p_rating: rating, p_request_id: requestId })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || "Nije uspelo čuvanje odgovora u Supabase-u.");
    return result;
  }
};


const insightsDb = {
  async load(token) {
    const headers={apikey:SUPABASE_KEY, Authorization:`Bearer ${token}`};
    const [a,b,c]=await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/vocab_test_attempts?select=word_id,mode,correct,answered_at,session_id&order=answered_at.desc&limit=10000`,{headers}),
      fetch(`${SUPABASE_URL}/rest/v1/vocab_word_tags?select=word_id,tag&limit=10000`,{headers}),
      fetch(`${SUPABASE_URL}/rest/v1/vocab_tags?select=name&order=name.asc&limit=10000`,{headers})
    ]);
    if(!a.ok || !b.ok)throw new Error("v7 tabele nisu dostupne. Proveri v7 SQL migraciju.");
    if(!c.ok)throw new Error("Nedostaje katalog tagova. Pokreni SQL migraciju v9.3 pre objavljivanja novog App.jsx.");
    return {attempts:await a.json(),tags:await b.json(),catalog:await c.json()};
  },
  async saveTest(token,attempts) {
    const response=await fetch(`${SUPABASE_URL}/rest/v1/vocab_test_attempts`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(attempts)});
    if(!response.ok)throw new Error("Nije uspelo čuvanje testa u Supabase.");
  },
  async addCatalogTag(token,name) {
    const response=await fetch(`${SUPABASE_URL}/rest/v1/vocab_tags`,{
      method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,"Content-Type":"application/json",Prefer:"return=representation"},
      body:JSON.stringify({name})
    });
    if(!response.ok){const err=await response.json().catch(()=>null);throw new Error(err?.message||"Tag nije sačuvan.");}
    return (await response.json())[0]?.name;
  },
  async removeCatalogTag(token,name) {
    const response=await fetch(`${SUPABASE_URL}/rest/v1/vocab_tags?name=eq.${encodeURIComponent(name)}`,{
      method:"DELETE",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,Prefer:"return=representation"}
    });
    if(!response.ok)throw new Error("Tag se ne može obrisati dok je dodeljen nekoj reči.");
    const rows=await response.json();
    if(!rows.length)throw new Error("Tag nije pronađen ili nemaš pravo brisanja.");
  },
  async replaceTags(token,userId,wordId,tags) {
    // RPC atomically replaces tags for the authenticated user's word.
    const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_vocab_word_tags`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({p_word_id:String(wordId),p_tags:tags})});
    if(!response.ok)throw new Error("Čuvanje tagova nije uspelo.");
  }
};

function getLocalDayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const db = {
  async getAll(token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?order=added_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
    return res.json();
  },
  async insert(w, token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ word: w.word, word_sr: w.wordSr, translation: w.translation, ipa: w.ipa, part_of_speech: w.partOfSpeech, synonyms: w.synonyms, sentences: w.sentences, notes: w.notes, status: "new", review_count: 0, image_url: w.imageUrl || null })
    });
    const data = await res.json();
    return data[0];
  },
  async updateStatus(id, status, reviewCount, learnedAt, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_count: reviewCount + 1, learned_at: learnedAt || null })
    });
  },
  async updateSentences(id, sentences, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentences })
    });
  },
  async updateTranslation(id, wordSr, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ word_sr: wordSr, translation: wordSr })
    });
  },
  async updateImageUrl(id, imageUrl, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl })
    });
  },
  async delete(id, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
  }
};

function normalize(r) {
  return { id: r.id, word: r.word, wordSr: r.word_sr, translation: r.word_sr || r.translation, ipa: r.ipa || "", partOfSpeech: r.part_of_speech, synonyms: r.synonyms || [], sentences: r.sentences || [], notes: r.notes || "", status: r.status || "new", addedAt: r.added_at, reviewCount: r.review_count || 0, learnedAt: r.learned_at, imageUrl: r.image_url || null };
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "short", year: "numeric" });
}

function highlightWord(sentence, word) {
  if (!word || !sentence) return sentence;
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = sentence.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <strong key={i} style={{ color: "#fff", fontWeight: 700 }}>{part}</strong> : part
  );
}


// Teme su na jednom mestu: nove teme se dodaju samo ovde.
const VOCAB_THEMES = {
  midnight: { name: "Midnight Pro", description: "Tamna indigo", colors: {
    bg: "#0b1020", panel: "#151d32", card: "#1b2741", elevated: "#202d49", border: "#344361", text: "#edf2ff", muted: "#9aabc9", subtle: "#7283a5", accent: "#7775f7", accentText: "#ffffff", accentSoft: "#aeb7ff", header: "#171f38", input: "#111b2e", dangerBg: "#321b2a", dangerBorder: "#6a3146", knownBg: "#172f2c", learningBg: "#361e2e", newBg: "#1b2b46", selectedBg: "#35316c", statusInactive: "#8694b1", action: "#d18a2d" } },
  ocean: { name: "Deep Ocean", description: "Tamna tirkizna", colors: {
    bg: "#061b25", panel: "#0c2935", card: "#103541", elevated: "#174450", border: "#285462", text: "#e9fcff", muted: "#99bec9", subtle: "#6a929f", accent: "#19b9b4", accentText: "#052528", accentSoft: "#6ce6de", header: "#0b2b39", input: "#0b252f", dangerBg: "#38212d", dangerBorder: "#7d4655", knownBg: "#153c36", learningBg: "#3c2735", newBg: "#15384b", selectedBg: "#19545d", statusInactive: "#96b8c4", action: "#c68529" } },
  graphite: { name: "Graphite Gold", description: "Ugalj i zlato", colors: {
    bg: "#111214", panel: "#1c1e20", card: "#242629", elevated: "#303235", border: "#414448", text: "#f3f0e9", muted: "#afada9", subtle: "#858689", accent: "#dba954", accentText: "#241a0b", accentSoft: "#edc989", header: "#1c1d20", input: "#1b1c1e", dangerBg: "#382427", dangerBorder: "#704247", knownBg: "#25392e", learningBg: "#3b292d", newBg: "#263440", selectedBg: "#4a3a29", statusInactive: "#aaa7a0", action: "#c58e35" } },
  ivory: { name: "Ivory Paper", description: "Topla svetla", colors: {
    bg: "#f7f5ef", panel: "#fffdf8", card: "#ffffff", elevated: "#f0eee7", border: "#dedbd2", text: "#262c36", muted: "#6b7481", subtle: "#9299a2", accent: "#4e64c8", accentText: "#ffffff", accentSoft: "#455cb5", header: "#fffdf8", input: "#ffffff", dangerBg: "#fff0f0", dangerBorder: "#edc9cc", knownBg: "#eff9f2", learningBg: "#fff0f2", newBg: "#f0f5fd", selectedBg: "#edf0ff", statusInactive: "#7b8490", action: "#cb8327" } },
  arctic: { name: "Arctic Blue", description: "Moderna svetla", colors: {
    bg: "#edf4fb", panel: "#ffffff", card: "#f8fbff", elevated: "#eaf2fc", border: "#cfdeec", text: "#172d45", muted: "#637c95", subtle: "#879bb0", accent: "#1678d4", accentText: "#ffffff", accentSoft: "#126ab7", header: "#ffffff", input: "#ffffff", dangerBg: "#fff0f3", dangerBorder: "#f1cbd2", knownBg: "#eaf9f4", learningBg: "#fff0f3", newBg: "#eaf4ff", selectedBg: "#e0efff", statusInactive: "#788fa8", action: "#d28a29" } }
};
const VOCAB_THEME_IDS = Object.keys(VOCAB_THEMES);


// v6 knowledge tests use only the already loaded user's words.
// They do not update vocabulary statuses or the v5 spaced repetition schedule.
function normalizeTestAnswer(value) {
  return String(value || "").normalize("NFC").toLocaleLowerCase("sr-RS")
    .replace(/[.!?„“"'’]/g, "").replace(/\s+/g, " ").trim();
}
function acceptedTestAnswers(value) {
  const source = String(value || "");
  const variants = [source, ...source.split(/\s*[/;,]\s*/).filter(Boolean)];
  return [...new Set(variants.map(normalizeTestAnswer).filter(Boolean))];
}
function randomizeTestItems(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function findClozeSentence(word) {
  const target = String(word.word || "").trim();
  if (!target) return null;
  const escape = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^\\p{L}])(${escape})(?=$|[^\\p{L}])`, "iu");
  for (const sentence of (word.sentences || [])) {
    const en = typeof sentence === "string" ? sentence : sentence?.en;
    if (typeof en === "string" && regex.test(en)) {
      return { masked: en.replace(regex, (_match, prefix) => `${prefix}_____`), full: en, sr: sentence?.sr || "" };
    }
  }
  return null;
}
function buildKnowledgeQuestions(words, mode, maxCount = 20) {
  const valid = words.filter(w => String(w.word || "").trim() && String(w.wordSr || w.translation || "").trim());
  const distinctTranslations = [...new Set(valid.map(w => normalizeTestAnswer(w.wordSr || w.translation)))];
  const pool = randomizeTestItems(valid).slice(0, maxCount);
  const all = [];
  for (let i = 0; i < pool.length; i++) {
    const word = pool[i];
    const cloze = findClozeSentence(word);
    const types = mode === "mixed"
      ? randomizeTestItems(["typing", "reverse", ...(distinctTranslations.length >= 4 ? ["choice"] : []), ...(cloze ? ["cloze"] : [])])
      : [mode];
    const type = types[0];
    if (type === "cloze" && !cloze) continue;
    if (type === "choice" && distinctTranslations.length < 4) continue;
    let options = [];
    if (type === "choice") {
      const correct = word.wordSr || word.translation;
      const incorrect = randomizeTestItems(valid.filter(w => normalizeTestAnswer(w.wordSr || w.translation) !== normalizeTestAnswer(correct)));
      const unique = [];
      for (const distractor of incorrect) {
        const text = distractor.wordSr || distractor.translation;
        if (!unique.some(x => normalizeTestAnswer(x) === normalizeTestAnswer(text))) unique.push(text);
        if (unique.length === 3) break;
      }
      if (unique.length < 3) continue;
      options = randomizeTestItems([correct, ...unique]);
    }
    all.push({ id: `${word.id}-${i}`, word, type, cloze, options });
  }
  return all;
}


// v7: CSV parser with quoted values, UTF-8 BOM and line breaks inside quotes.
function parseVocabCsv(input) {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (ch === '"') { if (quoted && text[i+1] === '"') { cell+='"'; i++; } else quoted=!quoted; }
    else if (ch === delimiter && !quoted) {row.push(cell);cell="";}
    else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && text[i+1] === "\n") i++; row.push(cell); if(row.some(v=>v.trim())) rows.push(row);row=[];cell=""; }
    else cell+=ch;
  }
  if (quoted) throw new Error("CSV ima nezatvorene navodnike.");
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if (!rows.length) return [];
  const headers=rows.shift().map(h=>h.trim().toLowerCase());
  const en=headers.findIndex(h=>["word","english","rec","reč","engleski"].includes(h));
  const sr=headers.findIndex(h=>["translation","word_sr","srpski","prevod"].includes(h));
  const tag=headers.indexOf("tags");
  if(en<0 || sr<0)throw new Error("CSV mora imati kolone word i translation.");
  return rows.map(r=>({word:(r[en]||"").trim(),translation:(r[sr]||"").trim(), tags:tag>=0?(r[tag]||"").split("|").map(v=>v.trim()).filter(Boolean):[]}))
    .filter(r=>r.word && r.translation);
}
function vocabCsvCell(value) {const safe=String(value??"").replace(/^[\s]*[=+@-]/, m=>"'"+m);return '"'+safe.replace(/"/g,'""')+'"';}
function downloadVocabCsv(rows, name) {
 const columns=["word","translation","status","tags"];
 const csv="\uFEFF"+[columns.join(";"),...rows.map(r=>columns.map(c=>vocabCsvCell(r[c])).join(";"))].join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const vocabDateKey = value => {const d=new Date(value);return Number.isNaN(d.getTime())?"":`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const vocabCardStyle = {background:"var(--v-panel)",border:"1px solid var(--v-border)",borderRadius:16,padding:20};


// v9.2: true treemap mosaic. All rectangles exactly tessellate the available area.
// A seeded shuffle changes placement, never the scores or the vocabulary data.
function mosaicHash(value) {
  let n = 2166136261;
  for (const c of String(value)) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
  return n >>> 0;
}
function mosaicShuffle(items, seed) {
  const list = [...items];
  let state = (seed >>> 0) || 0x9e3779b9;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
function mosaicSquarify(items, width, height) {
  if (!items.length || width <= 0 || height <= 0) return [];
  const sum = items.reduce((n, item) => n + Math.max(.01, item.weight), 0);
  const pending = items.map(item => ({...item, area: width * height * Math.max(.01,item.weight) / sum}));
  const result = [];
  let x = 0, y = 0, w = width, h = height;
  const badness = (row, side) => {
    const areas = row.map(i => i.area), total = areas.reduce((a,b)=>a+b,0);
    if (!total || !side) return Infinity;
    const max = Math.max(...areas), min = Math.max(.00001, Math.min(...areas));
    return Math.max((side*side*max)/(total*total), (total*total)/(side*side*min));
  };
  let row=[];
  const commit = () => {
    if (!row.length) return;
    const area = row.reduce((n,i)=>n+i.area,0);
    if (w >= h) { // horizontal strip through remaining width
      const strip = area / Math.max(.001, w);
      let at = x;
      row.forEach((item,index) => {
        const tileW = index === row.length-1 ? x+w-at : item.area / Math.max(.001,strip);
        result.push({...item,x:at,y,w:Math.max(0,tileW),h:Math.max(0,strip)}); at+=tileW;
      });
      y+=strip; h=Math.max(0,h-strip);
    } else { // vertical strip through remaining height
      const strip = area / Math.max(.001,h);
      let at=y;
      row.forEach((item,index)=>{
        const tileH=index===row.length-1?y+h-at:item.area/Math.max(.001,strip);
        result.push({...item,x,y:at,w:Math.max(0,strip),h:Math.max(0,tileH)});at+=tileH;
      });
      x+=strip;w=Math.max(0,w-strip);
    }
    row=[];
  };
  // Keep the order randomized, but pack into optimal-looking strips.
  for (const item of pending) {
    const side = Math.min(w,h);
    if (row.length && badness([...row,item],side)>badness(row,side)) commit();
    row.push(item);
  }
  commit();
  return result;
}
function WordMosaic({words, srsHistory, testHistory, srsSchedules, onOpen, combineMode, selectedIds, onToggleSelection}) {
  const rootRef = useRef(null);
  const [width, setWidth] = useState(960);
  const [shuffleSeed, setShuffleSeed] = useState(17);
  const [criterion, setCriterion] = useState(() => {
    try { return localStorage.getItem("vocab_mosaic_criterion") || "difficulty"; } catch { return "difficulty"; }
  });
  const [limit, setLimit] = useState(() => {
    try { return Number(localStorage.getItem("vocab_mosaic_limit")) || 0; } catch { return 0; }
  });
  useEffect(() => {
    if (!rootRef.current) return;
    const measure=()=>setWidth(Math.max(260,Math.floor(rootRef.current?.clientWidth || 960)));
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure); observer.observe(rootRef.current);
      return ()=>observer.disconnect();
    }
    window.addEventListener("resize",measure);
    return ()=>window.removeEventListener("resize",measure);
  }, []);
  const data = useMemo(() => {
    const history = {};
    for (const r of srsHistory || []) {
      const id = String(r.word_id); const v=history[id] || {total:0,errors:0,hard:0,last:null};
      v.total++; if (r.rating === "again") v.errors++; if (r.rating === "hard") v.hard++;
      const time = new Date(r.reviewed_at).getTime();if (Number.isFinite(time)) v.last=Math.max(v.last||0,time);
      history[id]=v;
    }
    for (const r of testHistory || []) {
      const id=String(r.word_id);const v=history[id] || {total:0,errors:0,hard:0,last:null};
      v.total++;if(!r.correct)v.errors++;
      const time=new Date(r.answered_at).getTime();if(Number.isFinite(time))v.last=Math.max(v.last||0,time);
      history[id]=v;
    }
    const now=Date.now();
    return words.map(word => {
      const id=String(word.id), stats=history[id] || {total:0,errors:0,hard:0,last:null};
      const schedule=srsSchedules[id];
      // Bayesian smoothing: sparse history should not dominate the diagram.
      const difficulty=(stats.errors + stats.hard*.6 + 1.5)/(stats.total+4);
      const delay=schedule?.due_at ? Math.max(0,(now-new Date(schedule.due_at).getTime())/86400000) : 0;
      const scores={difficulty:1+Math.min(7,difficulty*8),errors:1+Math.min(7,stats.errors*1.35),reviews:1+Math.min(7,stats.total*.6),overdue:1+Math.min(7,delay*.7),priority:1+Math.min(7,difficulty*5+Math.min(2,delay*.4))};
      return {word,stats,delay,weight:scores[criterion] || scores.difficulty};
    });
  },[words,srsHistory,testHistory,srsSchedules,criterion]);
  const picked=useMemo(()=>limit>0?data.slice(0,limit):data,[data,limit]);
  const height=Math.max(420,Math.ceil(picked.length/(width<440?2.8:width<760?4.5:7.5))*(width<440?105:105));
  const tiles=useMemo(()=>mosaicSquarify(mosaicShuffle(picked,shuffleSeed),width,height),[picked,shuffleSeed,width,height]);
  const chooseCriterion=(value)=>{setCriterion(value);try{localStorage.setItem("vocab_mosaic_criterion",value);}catch{}};
  const chooseLimit=(value)=>{setLimit(value);try{localStorage.setItem("vocab_mosaic_limit",String(value));}catch{}};
  const fieldStyle={background:"var(--v-input)",color:"var(--v-text)",border:"1px solid var(--v-border)",padding:"10px 11px",borderRadius:9,fontSize:12};
  const buttonStyle={...fieldStyle,cursor:"pointer"};
  return <section style={{border:"1px solid var(--v-border)",background:"var(--v-panel)",borderRadius:16,padding:14,marginTop:16}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:12}}>
      <div><strong style={{fontSize:18}}>▦ Mozaik reči</strong><div style={{fontSize:12,color:"var(--v-muted)",marginTop:3}}>Slagalica · veličina označava izabrani kriterijum</div></div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <label style={{fontSize:12,color:"var(--v-muted)"}}>Veličina po: <select style={fieldStyle} value={criterion} onChange={e=>chooseCriterion(e.target.value)}><option value="difficulty">Težini pamćenja</option><option value="priority">Prioritetu učenja</option><option value="errors">Broju grešaka</option><option value="reviews">Broju pokušaja</option><option value="overdue">Kašnjenju ponavljanja</option></select></label>
        <label style={{fontSize:12,color:"var(--v-muted)"}}>Reči: <select style={fieldStyle} value={limit} onChange={e=>chooseLimit(Number(e.target.value))}><option value={0}>Sve ({words.length})</option><option value={20}>Prvih 20</option><option value={40}>Prvih 40</option><option value={80}>Prvih 80</option></select></label>
        <button style={buttonStyle} onClick={()=>setShuffleSeed(s=>s+Math.floor(Math.random()*100000)+1)}>⤨ Promeni raspored</button>
      </div>
    </div>
    <div style={{fontSize:11,color:"var(--v-muted)",marginBottom:12}}>Veća polja znače veću vrednost kriterijuma. Bez istorije reč dobija neutralnu procenu. Boja označava status.</div>
    <div ref={rootRef} style={{position:"relative",width:"100%",height,overflow:"hidden",borderRadius:11,background:"var(--v-elevated)"}}>
      {tiles.map(tile=>{
        const word=tile.word, large=tile.w>=175&&tile.h>=90, tiny=tile.w<112||tile.h<66;
        const tint=word.status === "known" ? "var(--v-knownBg)" : word.status === "learning" ? "var(--v-learningBg)" : "var(--v-newBg)";
        const border=word.status === "known" ? "#22a36a" : word.status === "learning" ? "#e05a77" : "#4b98ee";
        const selected=combineMode&&selectedIds.includes(word.id);
        return <button type="button" key={String(word.id)} title={`${word.word} — ${word.translation || ""} | Pokušaja: ${tile.stats.total}, grešaka: ${tile.stats.errors}, težih: ${tile.stats.hard}`} onClick={()=>combineMode?onToggleSelection(word.id):onOpen(word)}
          style={{position:"absolute",left:tile.x+2,top:tile.y+2,width:Math.max(1,tile.w-4),height:Math.max(1,tile.h-4),background:selected?"var(--v-selectedBg)":tint,border:`1px solid ${selected?"var(--v-accent)":border+"66"}`,borderLeft:`3px solid ${border}`,color:"var(--v-text)",borderRadius:Math.min(12,Math.max(4,tile.h*.10)),padding:tiny?5:large?14:9,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"flex-start",gap:large?5:2,overflow:"hidden",textAlign:"left",cursor:"pointer",boxSizing:"border-box",boxShadow:"0 2px 9px rgba(0,0,0,.04)",transition:"filter .15s"}}>
          <strong style={{fontSize:tiny?11:large?Math.min(24,Math.max(16,tile.w/10)):14,fontFamily:"Georgia,serif",fontStyle:"italic",lineHeight:1.15,maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere",display:"-webkit-box",WebkitBoxOrient:"vertical",WebkitLineClamp:tiny?2:3,overflow:"hidden"}}>{word.word}</strong>
          {!tiny&&<span style={{fontSize:large?13:11,color:"var(--v-muted)",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{word.wordSr||word.translation}</span>}
          {large&&tile.w>225&&tile.h>118&&<span style={{position:"absolute",right:10,top:8,fontSize:10,color:border,fontWeight:700}}>{word.status==="known"?"Znam":word.status==="learning"?"Učim":"Novo"}</span>}
          {selected&&<span style={{position:"absolute",right:6,bottom:5,fontWeight:700,color:"var(--v-accent)"}}>✓</span>}
        </button>;
      })}
    </div>
    <div style={{fontSize:11,color:"var(--v-muted)",marginTop:10}}>Klik otvara detalje reči. Pretraga, status i tag filter iznad važe i za mozaik.</div>
  </section>;
}

export default function VocabTracker() {
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("sb_token") || null);
  const [authView, setAuthView] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [words, setWords] = useState([]);
  const [view, setView] = useState("list");
  const [layoutView, setLayoutView] = useState(() => { try { const saved=localStorage.getItem("vocab_layout_view"); return ["list","board","mosaic"].includes(saved)?saved:"list"; } catch { return "list"; } }); // list | board | mosaic
  const [workspaceTab, setWorkspaceTab] = useState("home"); // "home" | "dictionary"
  const [wordInput, setWordInput] = useState("");
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [practiceShuffle, setPracticeShuffle] = useState(false);
  const [practiceAnswers, setPracticeAnswers] = useState({});
  const [practiceMode, setPracticeMode] = useState("smart"); // smart | free
  const [testMode, setTestMode] = useState("typing");
  const [testQuestions, setTestQuestions] = useState([]);
  const [testIndex, setTestIndex] = useState(0);
  const [testInput, setTestInput] = useState("");
  const [testFeedback, setTestFeedback] = useState(null);
  const [testResults, setTestResults] = useState([]);
  const [testSessionId, setTestSessionId] = useState(null);
  const [testHistory, setTestHistory] = useState([]);
  const [wordTags, setWordTags] = useState({});
  const [tagCatalog, setTagCatalog] = useState([]);
  const [newCatalogTag, setNewCatalogTag] = useState("");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [tagSaveBusy, setTagSaveBusy] = useState(false);
  const [insightsReady, setInsightsReady] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [importRows, setImportRows] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [insightsRange, setInsightsRange] = useState(7);
  // v8 AI Learning: standalone exercises; no writes to SRS or vocabulary.
  const [aiLabMode, setAiLabMode] = useState("story");
  const [aiLabBusy, setAiLabBusy] = useState(false);
  const [aiLabError, setAiLabError] = useState("");
  const [aiLabStory, setAiLabStory] = useState(null);
  const [aiLabExercises, setAiLabExercises] = useState([]);
  const [aiLabExerciseIndex, setAiLabExerciseIndex] = useState(0);
  const [aiLabAnswer, setAiLabAnswer] = useState("");
  const [aiLabChecked, setAiLabChecked] = useState(false);
  const [aiLabShowTranslation, setAiLabShowTranslation] = useState(false);
  const [aiLabListenWord, setAiLabListenWord] = useState(null);
  const [aiLabChat, setAiLabChat] = useState([]);
  const [aiLabChatInput, setAiLabChatInput] = useState("");
  const [aiLabWordCount, setAiLabWordCount] = useState(5);
  const [aiLabSelectedTag, setAiLabSelectedTag] = useState("all");
  const [aiLabSelectionSeed, setAiLabSelectionSeed] = useState(0);

  const [srsSchedules, setSrsSchedules] = useState({});
  const [srsHistory, setSrsHistory] = useState([]);
  const [srsReady, setSrsReady] = useState(false);
  const [srsError, setSrsError] = useState("");
  const [srsSaving, setSrsSaving] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState([]);
  const [dayGoal, setDayGoal] = useState(() => {
    const stored = Number(localStorage.getItem("vocab_daily_goal"));
    return [10, 15, 20, 30, 50].includes(stored) ? stored : 20;
  });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [themeId, setThemeId] = useState(() => {
    try {
      const saved = localStorage.getItem("vocab_theme");
      return VOCAB_THEME_IDS.includes(saved) ? saved : "ivory";
    } catch { return "ivory"; }
  });
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const theme = VOCAB_THEMES[themeId];
  const chooseTheme = (id) => {
    if (!VOCAB_THEMES[id]) return;
    setThemeId(id);
    setThemeMenuOpen(false);
    try { localStorage.setItem("vocab_theme", id); } catch { /* bez memorije u privatnom modu */ }
  };
  // CSS varijable se postavljaju na <html>, zato tema važi i za login i modalne prikaze.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([name, value]) => root.style.setProperty(`--v-${name}`, value));
    root.style.colorScheme = ["ivory", "arctic"].includes(themeId) ? "light" : "dark";
    return () => { root.style.colorScheme = ""; };
  }, [themeId]);

  const [sortOrder, setSortOrder] = useState(() => {
    const saved = localStorage.getItem("vocab_sort");
    return ["newest", "oldest", "az", "za"].includes(saved) ? saved : "newest";
  });
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 600); // NEW
  const debounceRef = useRef(null);

  // NEW: track screen width
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token=")) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const accessToken = params.get("access_token");
      if (accessToken) {
        window.history.replaceState(null, "", window.location.pathname);
        setEmailConfirmed(true);
        setLoading(false);
        return;
      }
    }
    const savedToken = localStorage.getItem("sb_token");
    if (savedToken) {
      supabaseAuth.getUser(savedToken).then(async u => {
        if (u?.id) {
          setUser(u);
          setToken(savedToken);
          const rows = await db.getAll(savedToken);
          if (Array.isArray(rows)) setWords(rows.map(normalize));
          setLoading(false);
        } else {
          localStorage.removeItem("sb_token");
          setLoading(false);
        }
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id || !token) {
      setSrsSchedules({}); setSrsHistory([]); setSrsReady(false); setSrsError("");
      return;
    }
    let cancelled = false;
    setSrsReady(false);
    setSrsError("");
    smartDb.load(token).then(data => {
      if (cancelled) return;
      setSrsSchedules(Object.fromEntries(data.schedule.map(row => [String(row.word_id), row])));
      setSrsHistory(data.history);
      setSrsReady(true);
    }).catch(error => {
      if (!cancelled) { setSrsError(error.message); setSrsReady(false); }
    });
    return () => { cancelled = true; };
  }, [user?.id, token]);

  useEffect(() => {
    if(!user?.id || !token){setTestHistory([]);setWordTags({});setTagCatalog([]);setInsightsReady(false);return;}
    let cancelled=false;
    setInsightsReady(false);setInsightsError("");
    insightsDb.load(token).then(data=>{
      if(cancelled)return;
      setTestHistory(data.attempts);
      setTagCatalog(data.catalog.map(x=>x.name));
      const next={};
      for(const tagRow of data.tags){(next[String(tagRow.word_id)] ||= []).push(tagRow.tag);}
      setWordTags(next);setInsightsReady(true);
    }).catch(error=>{if(!cancelled){setInsightsError(error.message);setInsightsReady(false);}});
    return ()=>{cancelled=true;};
  },[user?.id,token]);

  // Centralni katalog, ne izvodimo opcije iz tagova pojedinačnih reči.
  const allTags=[...tagCatalog].sort((a,b)=>a.localeCompare(b,"sr"));
  const createCatalogTag=async(e)=>{
    e.preventDefault();
    const name=newCatalogTag.trim().replace(/\s+/g," ");
    if(!insightsReady||catalogSaving)return;
    if(!name||name.length>40){showToast("Naziv taga mora imati od 1 do 40 znakova.","#e11d48");return;}
    if(allTags.some(t=>t.toLocaleLowerCase("sr")===name.toLocaleLowerCase("sr"))){showToast("Ovaj tag već postoji.","#d97706");return;}
    setCatalogSaving(true);
    try {
      const stored=await insightsDb.addCatalogTag(token,name);
      if(!stored)throw new Error("Tag nije vraćen iz baze.");
      setTagCatalog(prev=>[...prev,stored]);setNewCatalogTag("");showToast("Tag kreiran ✓");
    }catch(err){showToast(err.message||"Greška pri kreiranju taga.","#e11d48");}
    finally{setCatalogSaving(false);}
  };
  const removeCatalogTag=async(name)=>{
    if(catalogSaving)return;
    if(Object.values(wordTags).some(tags=>tags.includes(name))){showToast("Prvo ukloni tag sa reči koje ga koriste.","#d97706");return;}
    setCatalogSaving(true);
    try{
      await insightsDb.removeCatalogTag(token,name);
      setTagCatalog(prev=>prev.filter(x=>x!==name));
      if(tagFilter===name)setTagFilter("all");
      if(aiLabSelectedTag===name)setAiLabSelectedTag("all");
      showToast("Tag obrisan ✓");
    }catch(err){showToast(err.message||"Brisanje nije uspelo.","#e11d48");}
    finally{setCatalogSaving(false);}
  };
  const saveWordTags=async (wordId,newTags)=>{
    if(!insightsReady||tagSaveBusy){if(!insightsReady)showToast(insightsError||"Pokreni SQL migraciju v9.3.","#e11d48");return;}
    const tags=[...new Set(newTags.map(x=>x.trim()).filter(Boolean))];
    if(tags.length>12){showToast("Najviše 12 tagova po reči.","#d97706");return;}
    if(tags.some(x=>!tagCatalog.includes(x))){showToast("Tag mora prvo biti kreiran u Podešavanjima.","#e11d48");return;}
    setTagSaveBusy(true);
    try {await insightsDb.replaceTags(token,user.id,wordId,tags);setWordTags(prev=>({...prev,[String(wordId)]:tags}));showToast("Tagovi sačuvani ✓");}
    catch(e){showToast(e.message,"#e11d48");}
    finally{setTagSaveBusy(false);}
  };
  const importVocabFile=async (file)=>{
    if(!file)return;
    setImportNotice("");setImportRows([]);
    try{
      if(file.size>2_000_000)throw new Error("Maksimalna veličina CSV fajla je 2 MB.");
      const parsed=parseVocabCsv(await file.text());
      const existing=new Set(words.map(w=>w.word.trim().toLocaleLowerCase("en")));
      const unique=new Set();
      const fresh=parsed.filter(r=>{const k=r.word.toLocaleLowerCase("en");if(existing.has(k)||unique.has(k))return false;unique.add(k);return true;});
      const unknown=[...new Set(fresh.flatMap(r=>r.tags).filter(tag=>!tagCatalog.includes(tag)))];
      if(unknown.length)throw new Error(`CSV sadrži nedefinisane tagove: ${unknown.slice(0,8).join(", ")}. Kreiraj ih prvo u Podešavanjima ili ih ukloni iz CSV fajla.`);
      setImportRows(fresh.slice(0,500));
      setImportNotice(`CSV: ${parsed.length} redova, ${fresh.length} novih bez duplikata${fresh.length>500?" (prvih 500 spremno za uvoz)":""}.`);
    }catch(e){setImportNotice(e.message);}
  };
  const commitVocabImport=async()=>{
    if(!importRows.length||importBusy)return;
    setImportBusy(true);let imported=0;let failed=0;
    for(const item of importRows){
      try{
        const row=await db.insert({word:item.word,wordSr:item.translation,translation:item.translation,ipa:"",partOfSpeech:"",synonyms:[],sentences:[],notes:"",imageUrl:null},token);
        if(!row?.id)throw new Error("Nije vraćen ID");
        setWords(prev=>[normalize(row),...prev]);imported++;
        if(item.tags.length && insightsReady){
          try{await insightsDb.replaceTags(token,user.id,row.id,item.tags);setWordTags(prev=>({...prev,[String(row.id)]:item.tags}));}
          catch(e){failed++;}
        }
      }catch(e){failed++;}
    }
    setImportRows([]);setImportBusy(false);
    setImportNotice(`Uvezeno: ${imported}. Greške (uključujući tagove): ${failed}.`);
  };
  const exportVocabCsv=()=>downloadVocabCsv(filteredWords.map(w=>({word:w.word,translation:w.wordSr||w.translation,status:w.status,tags:(wordTags[String(w.id)]||[]).join("|" )})),"vokabular_export.csv");
  const saveFinishedTest=async(results,sessionId)=>{
    if(!results.length||!sessionId||!insightsReady){if(!insightsReady)showToast("Test završen, ali v7 statistika nije aktivna.","#d97706");return;}
    const now=new Date().toISOString();
    const rows=results.map(r=>({session_id:sessionId,word_id:String(r.wordId),mode:r.type,correct:r.correct,answered_at:now}));
    try{await insightsDb.saveTest(token,rows);setTestHistory(prev=>[...rows,...prev]);}
    catch(e){showToast("Test je završen, ali istorija nije sačuvana.","#e11d48");}
  };

  const showToast = (msg, color = "#22c55e") => { setToast({ msg, color }); setTimeout(() => setToast(null), 2500); };

  const lookupWord = async (word) => {
    if (!word.trim() || word.trim().length < 2) { setAiData(null); return; }
    const cached = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (cached) { setAiData({ wordEn: cached.word, wordSr: cached.wordSr, translation: cached.translation, partOfSpeech: cached.partOfSpeech, sentences: cached.sentences }); return; }
    setAiLoading(true); setAiError(null); setAiData(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `You are a dictionary for a Serbian B1 English learner. User typed: "${word.trim()}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 3 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2","syn3"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"}]}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setAiData(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) { setAiError("Greška pri učitavanju. Pokušaj ponovo."); }
    setAiLoading(false);
  };

  const regenerateSentences = async (word, setter, currentSentences) => {
    if ((currentSentences?.length || 0) >= 10) { showToast("Maksimum 10 primera!", "#f59e0b"); return; }
    setRegenLoading(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 200, messages: [{ role: "user", content: `Give me 1 NEW example sentence for "${word}", NOT these:\n${currentSentences?.map(s => "- " + (s.en || s)).join("\n")}\nReply ONLY JSON object:\n{"en":"new sentence","sr":"prevod na srpski"}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const newSentence = JSON.parse(text.replace(/```json|```/g, "").trim());
      setter(prev => [...(prev || currentSentences), newSentence]);
      showToast("Primer dodat ✓");
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setRegenLoading(false);
  };

  const handleWordInput = (val) => { setWordInput(val); setAiData(null); setAiError(null); };

  const addWord = async () => {
    if (!wordInput.trim() || !aiData) return;
    const duplicate = words.find(w => w.word.toLowerCase() === (aiData.wordEn || wordInput.trim()).toLowerCase());
    if (duplicate) { showToast("Reč već postoji!", "#f59e0b"); return; }
    setSaving(true);
    try {
      const row = await db.insert({ word: aiData.wordEn || wordInput.trim(), wordSr: aiData.wordSr, translation: aiData.wordSr, ipa: aiData.ipa || "", partOfSpeech: aiData.partOfSpeech, synonyms: aiData.synonyms || [], sentences: aiData.sentences, notes: notes.trim(), imageUrl: null }, token);
      if (row) setWords(prev => [normalize(row), ...prev]);
      setWordInput(""); setAiData(null); setNotes(""); setView("list");
      showToast("Reč sačuvana ✓");
    } catch (e) { showToast("Greška pri čuvanju", "#ef4444"); }
    setSaving(false);
  };

  const updateStatus = async (id, status) => {
    const w = words.find(x => x.id === id);
    const learnedAt = status === "known" ? new Date().toISOString() : null;
    await db.updateStatus(id, status, w?.reviewCount || 0, learnedAt, token);
    setWords(prev => prev.map(x => x.id === id ? { ...x, status, reviewCount: (x.reviewCount || 0) + 1, learnedAt } : x));
  };

  const deleteWord = async (id) => {
    await db.delete(id, token);
    setWords(prev => prev.filter(x => x.id !== id)); setView("list");
    showToast("Obrisano", "#ef4444");
  };

  // Jedinstven redosled za listu, Board i PDF; bez izmena u Supabase bazi.
  const sortedWords = [...words].sort((a, b) => {
    if (sortOrder === "az") return (a.word || "").localeCompare(b.word || "", "en", { sensitivity: "base" });
    if (sortOrder === "za") return (b.word || "").localeCompare(a.word || "", "en", { sensitivity: "base" });
    const aTime = a.addedAt ? new Date(a.addedAt).getTime() || 0 : 0;
    const bTime = b.addedAt ? new Date(b.addedAt).getTime() || 0 : 0;
    return sortOrder === "oldest" ? aTime - bTime : bTime - aTime;
  });
  const searchedWords = sortedWords.filter(w =>
    (w.word || "").toLowerCase().includes(search.toLowerCase()) ||
    (w.translation || "").toLowerCase().includes(search.toLowerCase())
  );
  const filteredWords = searchedWords.filter(w => (filter === "all" || w.status === filter) && (tagFilter === "all" || (wordTags[String(w.id)]||[]).includes(tagFilter)));

  const todayStart = getLocalDayStart();
  const todaysReviews = srsHistory.filter(r => new Date(r.reviewed_at).getTime() >= todayStart);
  const todayCorrect = todaysReviews.filter(r => r.rating === "good").length;
  const dueWords = words.filter(w => {
    const schedule = srsSchedules[String(w.id)];
    return !schedule?.due_at || new Date(schedule.due_at).getTime() <= Date.now();
  }).sort((a, b) => {
    const dateA = srsSchedules[String(a.id)]?.due_at || "";
    const dateB = srsSchedules[String(b.id)]?.due_at || "";
    return dateA.localeCompare(dateB) || String(a.word).localeCompare(String(b.word), "en");
  });
  // Smart mode: one assessment per word per session. Free mode never writes SRS data.
  const reviewWords = (practiceMode === "smart" ? dueWords.filter(w => !sessionReviewed.includes(String(w.id))) : [...words])
    .sort((a, b) => practiceShuffle ? String(b.id).localeCompare(String(a.id)) :
      practiceMode === "smart" ? 0 : (a.addedAt || "").localeCompare(b.addedAt || ""));
  const currentReview = reviewWords[reviewIndex % Math.max(1, reviewWords.length)];
  const smartRemaining = reviewWords.length;
  const combinedAttempts=[...srsHistory.map(r=>({word_id:String(r.word_id),correct:r.rating==="good",answered_at:r.reviewed_at,mode:"SRS"})),...testHistory];
  const cutoff=Date.now()-insightsRange*86400000;
  const recentAttempts=combinedAttempts.filter(r=>new Date(r.answered_at).getTime()>=cutoff);
  const correctAttempts=recentAttempts.filter(r=>r.correct).length;
  const hardestWords=Object.entries(recentAttempts.reduce((o,r)=>{const id=String(r.word_id);const x=o[id]||{wrong:0,total:0};x.total++;if(!r.correct)x.wrong++;o[id]=x;return o;},{}))
    .map(([id,stats])=>({word:words.find(w=>String(w.id)===id)?.word||"(Obrisana reč)",...stats}))
    .filter(v=>v.wrong>0).sort((a,b)=>b.wrong-a.wrong||b.total-a.total).slice(0,10);
  const dailyInsights=Array.from({length:insightsRange},(_,i)=>{const date=new Date();date.setDate(date.getDate()-(insightsRange-1-i));const key=vocabDateKey(date);const day=recentAttempts.filter(r=>vocabDateKey(r.answered_at)===key);return {key,label:date.toLocaleDateString("sr-RS",{day:"2-digit",month:"2-digit"}),correct:day.filter(r=>r.correct).length,wrong:day.filter(r=>!r.correct).length};});
  const statusLabel = s => ({ new: "Novo", learning: "Učim", known: "Znam" }[s] || s);
  const statusDot = s => ({ new: "#3b82f6", learning: "#f59e0b", known: "#22c55e" }[s] || "var(--v-muted)");
  const counts = { all: words.length, new: words.filter(w => w.status === "new").length, learning: words.filter(w => w.status === "learning").length, known: words.filter(w => w.status === "known").length };
  const inp = { width: "100%", background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" };

  const [popup, setPopup] = useState(null);
  const [quickAdding, setQuickAdding] = useState(false);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editTranslationVal, setEditTranslationVal] = useState("");
  const [combineMode, setCombineMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [combineResult, setCombineResult] = useState(null);
  const [combineLoading, setCombineLoading] = useState(false);
  const [savingTo, setSavingTo] = useState(null);
  const [wordImage, setWordImage] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);

  const handleQuickAdd = async (word) => {
    if (!word || word.trim().length < 2) return;
    const already = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (already) { showToast("Već postoji u rečniku!", "#f59e0b"); setPopup(null); return; }
    setQuickAdding(true); setPopup(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `You are a dictionary for a Serbian B1 English learner. User typed: "${word.trim()}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 3 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"}]}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const ai = JSON.parse(text.replace(/```json|```/g, "").trim());
      const row = await db.insert({ word: ai.wordEn || word.trim(), wordSr: ai.wordSr, translation: ai.wordSr, ipa: ai.ipa || "", partOfSpeech: ai.partOfSpeech, synonyms: ai.synonyms || [], sentences: ai.sentences, notes: "", imageUrl: null }, token);
      if (row) setWords(prev => [normalize(row), ...prev]);
      showToast(`"${ai.wordEn}" dodato u rečnik ✓`);
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setQuickAdding(false);
  };

  const handleWordClick = (e, word) => {
    e.stopPropagation();
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    const clean = word.replace(/[^a-zA-ZčćžšđČĆŽŠĐ\s'-]/g, "").trim();
    if (!clean || clean.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    setPopup({ word: clean, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
  };

  const ClickableSentence = ({ text, highlightTarget }) => {
    const onMouseUpHandler = e => {
      const sel = window.getSelection();
      const selected = sel?.toString().trim();
      if (selected && selected.length >= 2 && selected.length <= 60) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopup({ word: selected, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
      }
    };
    if (highlightTarget && highlightTarget.trim().includes(" ")) {
      const escaped = highlightTarget.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escaped})`, "gi");
      const parts = text.split(regex);
      return (
        <span onMouseUp={onMouseUpHandler}>
          {parts.map((part, i) => regex.test(part) ? <strong key={i} style={{ color: "#fff", fontWeight: 700 }}>{part}</strong> : <span key={i}>{part}</span>)}
        </span>
      );
    }
    const tokens = text.split(/(\s+)/);
    return (
      <span onMouseUp={onMouseUpHandler}>
        {tokens.map((token, i) => {
          if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
          const clean = token.replace(/[^a-zA-ZčćžšđČĆŽŠĐ'-]/g, "");
          const isHighlighted = highlightTarget && clean.toLowerCase() === highlightTarget.toLowerCase();
          return (
            <span key={i} onClick={e => handleWordClick(e, clean)}
              style={{ cursor: "pointer", borderBottom: "1px dotted rgba(99,102,241,0.4)", borderRadius: 2, padding: "0 1px", fontWeight: isHighlighted ? 700 : "normal", color: isHighlighted ? "#fff" : "inherit" }}
              onMouseEnter={e => e.target.style.background = "rgba(99,102,241,0.2)"}
              onMouseLeave={e => e.target.style.background = "transparent"}
            >{token}</span>
          );
        })}
      </span>
    );
  };

  const SentenceCard = ({ s, i, word, onDelete, onUpdate }) => {
    const [editing, setEditing] = useState(false);
    const [editEn, setEditEn] = useState(s.en || s);
    const [editSr, setEditSr] = useState(s.sr || "");
    if (editing) {
      return (
        <div style={{ background: "rgba(99,102,241,0.12)", borderLeft: "2px solid var(--v-accent)", padding: "12px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "var(--v-accent)", letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Engleski</div>
            <textarea value={editEn} onChange={e => setEditEn(e.target.value)} rows={2} style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-accent)", color: "var(--v-text)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "var(--v-accent)", letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Srpski</div>
            <textarea value={editSr} onChange={e => setEditSr(e.target.value)} rows={2} style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-accent)", color: "var(--v-text)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onUpdate(i, { en: editEn, sr: editSr }); setEditing(false); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓ Sačuvaj</button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>✕ Odustani</button>
          </div>
        </div>
      );
    }
    return (
      <div style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid var(--v-accent)", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--v-text)", marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ color: "var(--v-accent)", fontFamily: "monospace", fontSize: 11, marginRight: 2, flexShrink: 0, marginTop: 2 }}>{i + 1}.</span>
          <span style={{ flex: 1 }}><ClickableSentence text={s.en || s} highlightTarget={word} /></span>
          <button onClick={() => speak(s.en || s)} title="Izgovori" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 2px", opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
          <button onClick={() => { setEditEn(s.en || s); setEditSr(s.sr || ""); setEditing(true); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, flexShrink: 0, color: "var(--v-accentSoft)" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>✎</button>
          <button onClick={() => onDelete(i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, flexShrink: 0, color: "#ef4444" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>✕</button>
        </div>
        {s.sr && <div style={{ fontSize: 12, color: "var(--v-muted)", fontStyle: "italic", paddingLeft: 20 }}>↳ {s.sr}</div>}
      </div>
    );
  };

  const fetchImage = async (word, cachedUrl = null, wordId = null) => {
    if (cachedUrl) { setWordImage({ url: cachedUrl, cached: true }); return; }
    setWordImage(null); setImageLoading(true);
    try {
      const res = await fetch(`/api/unsplash?query=${encodeURIComponent(word)}`);
      const data = await res.json();
      const photo = data.results?.[0];
      if (photo) {
        const imgUrl = photo.urls.small;
        setWordImage({ url: imgUrl, author: photo.user.name, authorUrl: photo.user.links.html });
        if (wordId) { await db.updateImageUrl(wordId, imgUrl, token); setWords(prev => prev.map(w => w.id === wordId ? { ...w, imageUrl: imgUrl } : w)); }
      }
    } catch (e) { setWordImage(null); }
    setImageLoading(false);
  };

  const speak = (text) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-US"; utt.rate = 0.9; utt.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang === "en-US" && v.name.includes("Google")) || voices.find(v => v.lang === "en-US");
    if (enVoice) utt.voice = enVoice;
    window.speechSynthesis.speak(utt);
  };

  const generateCombined = async () => {
    const sel = words.filter(w => selectedIds.includes(w.id));
    if (sel.length < 2) return;
    setCombineLoading(true); setCombineResult(null);
    try {
      const wordList = sel.map(w => w.word).join(", ");
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: `Write 3 natural English sentences that ALL use these words together: ${wordList}\nEach sentence must contain ALL the listed words. B1-B2 level.\nReply ONLY JSON array:\n[{"en":"sentence 1","sr":"srpski prevod"},{"en":"sentence 2","sr":"srpski prevod"},{"en":"sentence 3","sr":"srpski prevod"}]` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setCombineResult({ words: sel.map(w => w.word), sentences: JSON.parse(text.replace(/```json|```/g, "").trim()) });
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setCombineLoading(false);
  };

  const exportPDF = () => {
    const filterLabel = { all: "Sve reči", new: "Novo", learning: "Učim", known: "Znam" }[filter];
    const html = `<style>body{font-family:Georgia,serif;color:#111;padding:40px;max-width:800px;margin:0 auto}h1{font-size:28px;margin-bottom:4px}.subtitle{color:#888;font-size:13px;margin-bottom:32px}.word-block{border:1px solid #ddd;border-radius:10px;padding:20px;margin-bottom:20px;page-break-inside:avoid}.word{font-size:22px;font-style:italic;font-weight:700;margin-bottom:4px}.translation{font-size:16px;color:#333;margin-bottom:4px}.pos{font-size:11px;color:#999;font-family:monospace;margin-bottom:12px}.section-label{font-size:10px;letter-spacing:2px;color:#6366f1;text-transform:uppercase;margin-bottom:6px;margin-top:10px}.synonyms{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.syn-tag{background:#f0f0ff;border:1px solid #c7d2fe;color:#4338ca;padding:2px 10px;border-radius:20px;font-size:12px;font-style:italic}.sentence{border-left:3px solid #6366f1;padding:8px 12px;margin-bottom:8px;background:#f8f8ff;border-radius:0 6px 6px 0}.sentence-en{font-size:13px;margin-bottom:2px}.sentence-sr{font-size:12px;color:#666;font-style:italic}.notes{font-size:12px;color:#888;font-style:italic;border-top:1px solid #eee;padding-top:8px;margin-top:8px}.meta{font-size:10px;color:#bbb;font-family:monospace;margin-top:8px}.status-new{border-left:4px solid #3b82f6}.status-learning{border-left:4px solid #f59e0b}.status-known{border-left:4px solid #22c55e}@media print{body{padding:20px}}</style><h1>Vokabular Tracker</h1><div class="subtitle">Export: ${filterLabel} · ${filteredWords.length} reči · ${new Date().toLocaleDateString("sr-RS")}</div>${filteredWords.map(w => `<div class="word-block status-${w.status}"><div class="word">${w.word}</div><div class="translation">${w.wordSr || w.translation || ""}</div>${w.partOfSpeech ? `<div class="pos">${w.partOfSpeech}</div>` : ""}${w.synonyms?.length ? `<div class="section-label">Sinonimi</div><div class="synonyms">${w.synonyms.map(s => `<span class="syn-tag">${s}</span>`).join("")}</div>` : ""}${w.sentences?.length ? `<div class="section-label">Primeri</div>${w.sentences.map(s => `<div class="sentence"><div class="sentence-en">${s.en || s}</div>${s.sr ? `<div class="sentence-sr">↳ ${s.sr}</div>` : ""}</div>`).join("")}` : ""}${w.notes ? `<div class="notes">📝 ${w.notes}</div>` : ""}<div class="meta">Dodano: ${formatDate(w.addedAt)}${w.learnedAt ? ` · Naučeno: ${formatDate(w.learnedAt)}` : ""}</div></div>`).join("")}`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:9999;background:#fff;";
    document.body.appendChild(iframe);
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`);
    iframe.contentDocument.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); iframe.contentWindow.onafterprint = () => document.body.removeChild(iframe); }, 600);
  };

  const handleAuth = async () => {
    if (!authEmail || !authPassword) { setAuthError("Upiši email i lozinku."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) { setAuthError("Upiši ispravnu email adresu."); return; }
    if (authPassword.length < 6) { setAuthError("Lozinka mora imati najmanje 6 karaktera."); return; }
    setAuthLoading(true); setAuthError(null);
    try {
      const data = authView === "login"
        ? await supabaseAuth.signIn(authEmail, authPassword)
        : await supabaseAuth.signUp(authEmail, authPassword);
      if (data.error || data.error_code) {
        const msg = data.error_description || data.msg || data.error || "Greška pri prijavi.";
        if (msg.includes("Invalid login")) setAuthError("Pogrešan email ili lozinka.");
        else if (msg.includes("already registered")) setAuthError("Email je već registrovan. Prijavi se.");
        else if (msg.includes("confirm")) setAuthError("Potvrdi email adresu pre prijave.");
        else setAuthError(msg);
      } else if (authView === "register" && !data.access_token) {
        setAuthError("Registracija uspješna! Provjeri email i potvrdi nalog, zatim se prijavi.");
      } else if (data.access_token) {
        localStorage.setItem("sb_token", data.access_token);
        setToken(data.access_token);
        setUser(data.user);
        const rows = await db.getAll(data.access_token);
        if (Array.isArray(rows)) setWords(rows.map(normalize));
      }
    } catch (e) { setAuthError("Greška pri povezivanju. Pokušaj ponovo."); }
    setAuthLoading(false);
  };

  // v8 uses the existing /api/claude proxy. It does not expose any new API key.
  const requestAiLearning = async (prompt, maxTokens = 850) => {
    const response = await fetch("/api/claude", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }] })
    });
    if (!response.ok) throw new Error(`AI servis nije dostupan (${response.status}).`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "AI servis je prijavio grešku.");
    const content = data.content?.filter(part => part.type === "text").map(part => part.text).join("\n") || "";
    if (!content.trim()) throw new Error("AI servis nije vratio odgovor.");
    return content.trim();
  };
  const parseAiLearningJson = text => {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try { return JSON.parse(cleaned); }
    catch { throw new Error("AI odgovor nije u očekivanom formatu. Pokušaj ponovo."); }
  };
  const aiLabPool = words.filter(w =>
    (aiLabSelectedTag === "all" || (wordTags[String(w.id)] || []).includes(aiLabSelectedTag)) &&
    String(w.word || "").trim() && String(w.wordSr || w.translation || "").trim());
  // Keep the selected words stable while typing/checking answers; shuffle only
  // when the vocabulary, filters or explicit selection change.
  const aiLabChosenWords = useMemo(
    () => randomizeTestItems(aiLabPool).slice(0, aiLabWordCount),
    [words, wordTags, aiLabSelectedTag, aiLabWordCount, aiLabSelectionSeed]
  );
  const aiLabVocabulary = aiLabChosenWords.map(w => `${w.word} (${w.wordSr || w.translation})`).join(", ");
  const aiLabTags = [...new Set(Object.values(wordTags).flat().filter(Boolean))].sort((a, b) => a.localeCompare(b, "sr"));
  const startAiLearning = async (mode = aiLabMode) => {
    if (aiLabBusy) return;
    setAiLabMode(mode); setAiLabError(""); setAiLabChecked(false);
    setAiLabAnswer(""); setAiLabExerciseIndex(0); setAiLabShowTranslation(false);
    if (mode === "listen") {
      if (!aiLabChosenWords.length) { setAiLabError("Nema reči za ovu kategoriju."); return; }
      setAiLabListenWord(aiLabChosenWords[Math.floor(Math.random() * aiLabChosenWords.length)]);
      return;
    }
    if (!aiLabChosenWords.length) { setAiLabError("Dodaj reči sa prevodom ili izaberi drugu kategoriju."); return; }
    if (mode === "chat") {
      setAiLabChat([{ role: "assistant", content: `Let's practise English! Try to use these words: ${aiLabChosenWords.map(w => w.word).join(", ")}. What did you do today?` }]);
      return;
    }
    setAiLabBusy(true);
    try {
      if (mode === "story") {
        const text = await requestAiLearning(`Create an original short, coherent B1-B2 English story (120-180 words) naturally using these vocabulary entries: ${aiLabVocabulary}. Include the given English words naturally; do not force all if unnatural. Provide a full natural Serbian translation. Reply ONLY JSON: {"title":"English title","paragraphs":["English paragraph 1","English paragraph 2","English paragraph 3"],"serbian":"Complete Serbian translation","usedWords":["English word"]}. No markdown.`, 1100);
        const data = parseAiLearningJson(text);
        if (!Array.isArray(data.paragraphs) || !data.paragraphs.length ||
            !data.paragraphs.every(p => typeof p === "string" && p.trim()) ||
            typeof data.serbian !== "string") throw new Error("Priča nije pravilno generisana.");
        setAiLabStory(data);
      } else if (mode === "cloze") {
        const text = await requestAiLearning(`Create exactly 5 B1-B2 English cloze exercises using these words/phrases: ${aiLabVocabulary}. Each exercise must have a complete grammatical English sentence containing one target word once. Return ONLY JSON {"exercises":[{"sentence":"Sentence with _____ replacing the missing target word or phrase","answer":"exact English missing word/phrase","translation":"Serbian translation of full sentence","hint":"short Serbian hint"}]}. All five should be meaningful and different. No markdown.`, 1000);
        const data = parseAiLearningJson(text);
        const exerciseList = (Array.isArray(data.exercises) ? data.exercises : [])
          .filter(x => x && typeof x.sentence === "string" && x.sentence.includes("_____") &&
            typeof x.answer === "string" && x.answer.trim() &&
            x.sentence.length < 600 && x.answer.length < 100)
          .slice(0, 5);
        if (!exerciseList.length) throw new Error("AI nije vratio ispravne zadatke.");
        setAiLabExercises(exerciseList);
      }
    } catch (error) { setAiLabError(error.message || "Generisanje nije uspelo."); }
    finally { setAiLabBusy(false); }
  };
  const sendAiLabChat = async () => {
    const message = aiLabChatInput.trim();
    if (!message || aiLabBusy) return;
    const history = [...aiLabChat, { role: "user", content: message }];
    setAiLabChat(history); setAiLabChatInput(""); setAiLabError(""); setAiLabBusy(true);
    try {
      const context = history.slice(-8).map(m => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content}`).join("\n");
      const text = await requestAiLearning(`You are a supportive English B1-B2 conversation tutor. Chat with the learner in natural English, asking one brief follow-up question per turn. Encourage using these target words: ${aiLabVocabulary}. Gently correct an English error in one short sentence when relevant. Do not pretend to be the learner. Keep each response under 75 words. Conversation:\n${context}\nTutor:`, 200);
      setAiLabChat(prev => [...prev, { role: "assistant", content: text.replace(/^Tutor:\s*/i, "") }]);
    } catch (error) { setAiLabError(error.message || "AI razgovor nije dostupan."); }
    finally { setAiLabBusy(false); }
  };

  const startKnowledgeTest = (mode = testMode) => {
    const questions = buildKnowledgeQuestions(words, mode);
    setTestMode(mode);
    setTestQuestions(questions);
    setTestIndex(0);
    setTestInput("");
    setTestFeedback(null);
    setTestResults([]);
    setTestSessionId(crypto.randomUUID());
    setView("test");
  };
  const submitKnowledgeAnswer = (answer = testInput) => {
    const question = testQuestions[testIndex];
    if (!question || testFeedback) return;
    const expected = question.type === "reverse" || question.type === "cloze"
      ? question.word.word : (question.word.wordSr || question.word.translation);
    const correct = acceptedTestAnswers(expected).includes(normalizeTestAnswer(answer));
    const result = { id: question.id, wordId: question.word.id, word: question.word.word, correct, type: question.type, expected, given: String(answer || "") };
    setTestResults(prev => [...prev, result]);
    setTestFeedback(result);
  };
  const nextKnowledgeQuestion = () => {
    if (!testFeedback) return;
    if(testIndex===testQuestions.length-1)saveFinishedTest(testResults,testSessionId);
    setTestIndex(i => i + 1);
    setTestInput("");
    setTestFeedback(null);
  };

  const startPractice = (mode) => {
    if (mode === "smart" && !srsReady) {
      showToast(srsError || "Prvo aktiviraj Smart Learning SQL migraciju.", "#e11d48");
      return;
    }
    setPracticeMode(mode);
    setSessionReviewed([]);
    setReviewIndex(0);
    setRevealed(false);
    setView("review");
  };
  const practiceAdvance = () => {
    if (practiceMode === "smart" && currentReview) {
      // Preskočena reč se sklanja samo iz ove sesije; ostaje dospela za kasnije.
      setSessionReviewed(prev => [...prev, String(currentReview.id)]);
      setReviewIndex(0);
    } else {
      setReviewIndex(i => reviewWords.length ? (i + 1) % reviewWords.length : 0);
    }
    setRevealed(false);
  };
  const practiceRate = async (rating) => {
    if (!currentReview || srsSaving) return;
    const id = String(currentReview.id);
    if (practiceMode === "free") {
      setPracticeAnswers(prev => ({ ...prev, [id]: rating }));
      practiceAdvance();
      return;
    }
    if (!srsReady) return;
    setSrsSaving(true);
    try {
      const requestId = crypto.randomUUID();
      const result = await smartDb.rate(token, id, rating === "known" ? "good" : rating, requestId);
      setSrsSchedules(prev => ({ ...prev, [id]: result.schedule }));
      setSrsHistory(prev => [{ word_id: id, rating: result.rating, reviewed_at: result.reviewed_at }, ...prev]);
      setSessionReviewed(prev => [...prev, id]);
      setReviewIndex(0);
      setPracticeAnswers(prev => ({ ...prev, [id]: rating }));
      setRevealed(false);
    } catch (error) {
      showToast(error.message || "Greška pri čuvanju odgovora.", "#e11d48");
    } finally { setSrsSaving(false); }
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v-accent)", fontFamily: "monospace", letterSpacing: 3 }}>UČITAVANJE BAZE...</div>;
  if (dbError) return <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ background: "var(--v-dangerBg)", border: "1px solid var(--v-dangerBorder)", borderRadius: 16, padding: 32, color: "#ef4444", fontFamily: "monospace", maxWidth: 400, textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div><div>{dbError}</div></div></div>;

  if (emailConfirmed) return (
    <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--v-panel)", border: "1px solid #22c55e44", borderRadius: 20, padding: 48, width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "var(--v-accent)", marginBottom: 12, textTransform: "uppercase" }}>Vokabular Tracker</div>
        <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: "normal", color: "var(--v-text)" }}>Email uspešno potvrđen!</h2>
        <p style={{ color: "var(--v-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>Tvoj nalog je aktiviran i spreman za korišćenje.<br />Možeš se sada prijaviti u sistem.</p>
        <button onClick={() => setEmailConfirmed(false)} style={{ background: "var(--v-accent)", border: "none", color: "var(--v-accentText)", padding: "14px 40px", borderRadius: 10, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1 }}>PRIJAVI SE →</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 20, padding: 40, width: "100%", maxWidth: 400 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Vokabular Tracker</div>
        <h1 style={{ margin: "0 0 32px", fontSize: 24, fontWeight: "normal" }}>{authView === "login" ? "Prijava" : "Registracija"}</h1>
        {authError && <div style={{ background: "var(--v-dangerBg)", border: "1px solid var(--v-dangerBorder)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{authError}</div>}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Email</label>
          <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} placeholder="vas@email.com"
            style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Lozinka</label>
          <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} placeholder="••••••••"
            style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
        </div>
        <button onClick={handleAuth} disabled={authLoading}
          style={{ width: "100%", background: authLoading ? "var(--v-elevated)" : "var(--v-accent)", border: "none", color: "#fff", padding: "14px", borderRadius: 10, cursor: authLoading ? "default" : "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, marginBottom: 16 }}>
          {authLoading ? "ČEKAJ..." : authView === "login" ? "PRIJAVI SE" : "REGISTRUJ SE"}
        </button>
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--v-muted)" }}>
          {authView === "login" ? "Nemaš nalog?" : "Već imaš nalog?"}
          <button onClick={() => { setAuthView(authView === "login" ? "register" : "login"); setAuthError(null); }}
            style={{ background: "none", border: "none", color: "var(--v-accent)", cursor: "pointer", fontSize: 13, marginLeft: 6, textDecoration: "underline" }}>
            {authView === "login" ? "Registruj se" : "Prijavi se"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="v9-app" style={{ minHeight: "100vh", background: "var(--v-bg)", fontFamily: "Arial, sans-serif", color: "var(--v-text)" }} onClick={() => { setPopup(null); setThemeMenuOpen(false); }}> 
      {popup && (
        <div style={{ position: "fixed", left: Math.min(Math.max(popup.x - 80, 8), window.innerWidth - 200), top: Math.min(popup.y + 8, window.innerHeight - 80), zIndex: 9999, background: "var(--v-panel)", border: "1px solid var(--v-accent)", borderRadius: 12, padding: "10px 16px", boxShadow: "0 8px 32px rgba(0,0,0,0.7)", display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap", maxWidth: "90vw" }}>
          <span style={{ fontSize: 13, color: "var(--v-accentSoft)", fontStyle: "italic", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>"{popup.word}"</span>
          <button onClick={() => handleQuickAdd(popup.word)} style={{ background: "var(--v-accent)", border: "none", color: "var(--v-accentText)", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}>+ Dodaj</button>
          <button onClick={() => setPopup(null)} style={{ background: "none", border: "none", color: "var(--v-muted)", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>✕</button>
        </div>
      )}

      {quickAdding && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "var(--v-accent)", color: "#fff", padding: "12px 20px", borderRadius: 10, fontFamily: "monospace", fontSize: 13, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}>⟳ Dodajem u rečnik...</div>
      )}
      {toast && <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.color, color: "#fff", padding: "10px 20px", borderRadius: 8, fontFamily: "monospace", fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>{toast.msg}</div>}

      {/* V9: Responsive navigation shell */}
      <div className="v9-sidebar" style={{ background: "var(--v-header)", borderBottom: "1px solid var(--v-border)", padding: "22px 24px 20px" }}>
        <div className="v9-sidebar-inner" style={{ maxWidth: 1080, margin: "0 auto", width: "100%" }}>
          <div className="v9-sidebar-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}> 
            <div>
              <div style={{ fontSize: 11, letterSpacing: 4, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Vokabular Tracker</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: "normal", letterSpacing: -0.5 }}>Moj engleski</h1>
              <div style={{ fontSize: 10, color: "var(--v-subtle)", fontFamily: "monospace", marginTop: 4 }}>● Supabase Cloud</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div style={{ fontSize: 11, color: "var(--v-muted)", fontFamily: "monospace" }}>{user.email}</div>
              <div style={{ position: "relative", zIndex: 30 }}>
                <button type="button" onClick={e => { e.stopPropagation(); setThemeMenuOpen(v => !v); }}
                  aria-label="Promeni temu" aria-expanded={themeMenuOpen} title="Izaberi temu"
                  style={{ background: "var(--v-elevated)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "7px 11px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
                  🎨 {theme.name} ▾
                </button>
                {themeMenuOpen && (
                  <div onClick={e => e.stopPropagation()} style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 245, maxWidth: "85vw", background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 12, padding: 8, boxShadow: "0 16px 40px rgba(0,0,0,0.22)", zIndex: 1000 }}>
                    <div style={{ padding: "6px 8px 10px", color: "var(--v-muted)", fontFamily: "monospace", fontSize: 11 }}>IZABERI TEMU</div>
                    {VOCAB_THEME_IDS.map(id => {
                      const item = VOCAB_THEMES[id];
                      return (
                        <button key={id} type="button" onClick={() => chooseTheme(id)}
                          style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: id === themeId ? "1px solid var(--v-accent)" : "1px solid transparent", borderRadius: 8, padding: "8px", marginBottom: 3, textAlign: "left", background: id === themeId ? "var(--v-elevated)" : "transparent", cursor: "pointer", color: "var(--v-text)" }}>
                          <span style={{ display: "flex", gap: 2, padding: 4, border: `1px solid ${item.colors.border}`, background: item.colors.bg, borderRadius: 6 }}>
                            {[item.colors.card, item.colors.accent, item.colors.text].map((color, i) => <span key={i} style={{ width: 10, height: 22, background: color, borderRadius: 3 }} />)}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>{item.name}</span>
                            <span style={{ display: "block", fontSize: 10, color: "var(--v-muted)", marginTop: 2 }}>{item.description}</span>
                          </span>
                          {id === themeId && <span style={{ color: "var(--v-accentSoft)" }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => { supabaseAuth.signOut(token); localStorage.removeItem("sb_token"); setUser(null); setToken(null); setWords([]); }} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>odjavi se</button>
            </div>
          </div>
          <div className="vocab-topnav v9-navigation" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[["home", "⌂  Početna"], ["dictionary", "▤  Rečnik"]].map(([id, label]) => (
              <button key={id} onClick={() => { setWorkspaceTab(id); setView("list"); setCombineMode(false); }}
                style={{ border: "1px solid " + ((view === "list" && workspaceTab === id) ? "var(--v-accent)" : "var(--v-border)"), background: (view === "list" && workspaceTab === id) ? "var(--v-accent)" : "var(--v-panel)", color: (view === "list" && workspaceTab === id) ? "var(--v-accentText)" : "var(--v-text)", padding: "10px 17px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                {label}
              </button>
            ))}
            <button onClick={() => {setView("insights");setCombineMode(false);}} style={{border:"1px solid var(--v-border)",background:view==="insights"?"var(--v-accent)":"var(--v-panel)",color:view==="insights"?"var(--v-accentText)":"var(--v-text)",padding:"10px 17px",borderRadius:10,fontWeight:600,cursor:"pointer",fontSize:13}}>▥ Statistika</button>
            <button onClick={() => {setView("settings");setCombineMode(false);}} aria-current={view==="settings"?"page":undefined}
              style={{border:"1px solid var(--v-border)",background:view==="settings"?"var(--v-accent)":"var(--v-panel)",color:view==="settings"?"var(--v-accentText)":"var(--v-text)",padding:"10px 17px",borderRadius:10,fontWeight:600,cursor:"pointer",fontSize:13}}>⚙ Podešavanja</button>
            <button onClick={() => startPractice(srsReady ? "smart" : "free")} disabled={words.length === 0}
              style={{ border: "1px solid " + (view === "review" ? "var(--v-accent)" : "var(--v-border)"), background: view === "review" ? "var(--v-accent)" : "var(--v-panel)", color: view === "review" ? "var(--v-accentText)" : "var(--v-text)", padding: "10px 17px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13, opacity: words.length ? 1 : 0.5 }}>
              ◎  Vežbanje
            </button>
            <button onClick={() => { setView("aiLab"); setAiLabError(""); }}
              style={{ border: "1px solid var(--v-border)", background: view === "aiLab" ? "var(--v-accent)" : "var(--v-panel)", color: view === "aiLab" ? "var(--v-accentText)" : "var(--v-text)", padding: "10px 17px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              ✨ AI Učenje
            </button>
            <button onClick={() => startKnowledgeTest()} disabled={words.length === 0}
              style={{ border: "1px solid " + (view === "test" ? "var(--v-accent)" : "var(--v-border)"), background: view === "test" ? "var(--v-accent)" : "var(--v-panel)", color: view === "test" ? "var(--v-accentText)" : "var(--v-text)", padding: "10px 17px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13, opacity: words.length ? 1 : .5 }}>
              ✎ &nbsp; Testovi
            </button>
            <button onClick={() => { setWorkspaceTab("dictionary"); setView("add"); setWordInput(""); setAiData(null); setNotes(""); }}
              style={{ marginLeft: "auto", background: "var(--v-accent)", color: "var(--v-accentText)", border: "none", borderRadius: 10, padding: "10px 17px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              + Dodaj reč
            </button>
          </div>
          <div className="v9-status-shortcuts" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["all", "new", "learning", "known"].map(s => (
              <button key={s} onClick={() => { setFilter(s); setWorkspaceTab("dictionary"); setView("list"); }} style={{ background: filter === s ? "var(--v-accent)" : "rgba(255,255,255,0.05)", border: "1px solid " + (filter === s ? "var(--v-accent)" : "var(--v-border)"), color: filter === s ? "var(--v-accentText)" : "var(--v-muted)", padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
                {s === "all" ? "Sve" : statusLabel(s)} ({counts[s]})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="v9-main">
      {/* ADD VIEW */}
      {view === "add" && (
        <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setView("list")} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: "normal" }}>Nova Reč</h2>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Upiši reč ili frazu (srpski ili engleski)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={wordInput} onChange={e => handleWordInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && wordInput.trim().length >= 2) lookupWord(wordInput); }} placeholder="npr. equity, take for granted, prinos..." autoFocus style={{ ...inp, flex: 1, fontSize: 18, fontStyle: "italic", padding: "14px 16px" }} />
              <button onClick={() => lookupWord(wordInput)} disabled={wordInput.trim().length < 2 || aiLoading} style={{ background: wordInput.trim().length >= 2 ? "var(--v-accent)" : "var(--v-panel)", border: "1px solid " + (wordInput.trim().length >= 2 ? "var(--v-accent)" : "var(--v-border)"), color: wordInput.trim().length >= 2 ? "#fff" : "var(--v-subtle)", padding: "0 20px", borderRadius: 8, cursor: wordInput.trim().length >= 2 ? "pointer" : "default", fontSize: 18, transition: "all 0.15s", flexShrink: 0 }}>{aiLoading ? "⟳" : "→"}</button>
            </div>
          </div>
          {aiLoading && <div style={{ background: "var(--v-panel)", borderRadius: 12, padding: 24, border: "1px solid var(--v-border)", marginBottom: 20, textAlign: "center", color: "var(--v-accent)", fontFamily: "monospace", fontSize: 13, letterSpacing: 2 }}>TRAŽIM...</div>}
          {aiError && <div style={{ background: "var(--v-dangerBg)", border: "1px solid var(--v-dangerBorder)", borderRadius: 12, padding: 16, marginBottom: 20, color: "#ef4444", fontSize: 13 }}>{aiError}</div>}
          {aiData && !aiLoading && (
            <div style={{ background: "var(--v-panel)", borderRadius: 16, padding: 24, border: "1px solid var(--v-accent)", marginBottom: 20 }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 22, color: "var(--v-text)" }}>{wordInput.trim().toLowerCase() === aiData.wordSr?.toLowerCase() ? aiData.wordEn : aiData.wordSr}</div>
                  <button onClick={() => speak(aiData.wordEn || wordInput)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
                </div>
                {aiData.ipa && <div style={{ fontSize: 13, color: "var(--v-accent)", fontFamily: "monospace", marginTop: 3, letterSpacing: 1 }}>{aiData.ipa}</div>}
                {aiData.partOfSpeech && <div style={{ fontSize: 12, color: "var(--v-muted)", fontFamily: "monospace", marginTop: 4 }}>{aiData.partOfSpeech}</div>}
              </div>
              {aiData.synonyms?.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {aiData.synonyms.map((syn, i) => (
                      <span key={i} onClick={e => { e.stopPropagation(); const rect = e.target.getBoundingClientRect(); setPopup({ word: syn, x: rect.left + rect.width / 2, y: rect.bottom + 8 }); }} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--v-accentSoft)", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic", cursor: "pointer" }} onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.3)"; e.target.style.borderColor = "var(--v-accent)"; }} onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = "rgba(99,102,241,0.3)"; }}>{syn}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(wordInput, (updater) => setAiData(prev => ({ ...prev, sentences: typeof updater === "function" ? updater(prev.sentences) : updater })), aiData.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid var(--v-accent)", color: regenLoading ? "var(--v-subtle)" : "var(--v-accentSoft)", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>{regenLoading ? "..." : "+ dodaj primer"}</button>
                </div>
                {aiData.sentences?.map((s, i) => <SentenceCard key={i} s={s} i={i} word={wordInput} onDelete={idx => setAiData(prev => ({ ...prev, sentences: prev.sentences.filter((_, j) => j !== idx) }))} onUpdate={(idx, updated) => setAiData(prev => ({ ...prev, sentences: prev.sentences.map((x, j) => j === idx ? updated : x) }))} />)}
              </div>
            </div>
          )}
          {aiData && !aiLoading && <div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Tvoje beleške (opcionalno)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. viđeno u Bloomberg članku o ETF-ima..." rows={2} style={{ ...inp, resize: "vertical", fontFamily: "Georgia, serif" }} /></div>}
          {aiData && !aiLoading && <div style={{ height: 80 }} />}
        </div>
      )}

      {view === "add" && aiData && !aiLoading && (
        <button onClick={addWord} style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "var(--v-action)", border: "none", color: "#fff", padding: "14px 36px", borderRadius: 50, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 2, boxShadow: "0 4px 24px rgba(217,119,6,0.5)", zIndex: 100, whiteSpace: "nowrap" }}>
          {saving ? "ČUVAM..." : "SAČUVAJ U BAZU →"}
        </button>
      )}

      {/* DETAIL VIEW */}
      {view === "detail" && selected && (
        <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setWordImage(null); }} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
          </div>
          <div style={{ background: "var(--v-panel)", borderRadius: 16, padding: 28, border: "1px solid " + (selected.status === "known" ? "#22c55e44" : selected.status === "learning" ? "#e11d4844" : "var(--v-border)"), transition: "background 0.4s, border-color 0.4s" }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 28, fontWeight: "normal", fontStyle: "italic", wordBreak: "break-word" }}>{selected.word}</h2>
                {selected.ipa && <span style={{ fontSize: 13, color: "var(--v-accent)", fontFamily: "monospace", letterSpacing: 1 }}>{selected.ipa}</span>}
                <button onClick={() => speak(selected.word)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                  <div key={s} style={{ position: "relative" }}>
                    <button onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, status: s })); showToast("Status ažuriran"); }} style={{ background: selected.status === s ? color : "transparent", border: "1px solid " + (selected.status === s ? color : "rgba(255,255,255,0.2)"), color: selected.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>{label}</button>
                    <div className="tip" style={{ position: "absolute", bottom: 38, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                  </div>
                ))}
                <div style={{ position: "relative" }}>
                  <button onClick={() => deleteWord(selected.id)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "var(--v-statusInactive)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "var(--v-text)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--v-statusInactive)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                  <div className="tip" style={{ position: "absolute", bottom: 38, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                </div>
                <span style={{ marginLeft: "auto", background: "rgba(99,102,241,0.15)", color: selected.status === "new" ? "#3b82f6" : selected.status === "learning" ? "#e11d48" : "#22c55e", padding: "4px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>{selected.status === "new" ? "Novo" : selected.status === "learning" ? "Učim" : "Znam"}</span>
              </div>
            </div>
            {imageLoading && <div style={{ height: 160, background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v-subtle)", fontFamily: "monospace", fontSize: 12 }}>učitavam sliku...</div>}
            {wordImage && !imageLoading && (
              <div style={{ marginBottom: 16, borderRadius: 10, overflow: "hidden", position: "relative" }}>
                <img src={wordImage.url} alt={selected.word} onError={e => { e.target.parentNode.style.display = "none"; }} style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
                {wordImage.author && <a href={`${wordImage.authorUrl}?utm_source=vokabular_tracker&utm_medium=referral`} target="_blank" rel="noreferrer" style={{ position: "absolute", bottom: 6, right: 8, fontSize: 10, color: "var(--v-muted)", textDecoration: "none", background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: 4 }}>Photo by {wordImage.author} on Unsplash</a>}
              </div>
            )}
            {selected.translation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                {editingTranslation ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input value={editTranslationVal} onChange={e => setEditTranslationVal(e.target.value)} autoFocus style={{ flex: 1, background: "var(--v-input)", border: "1px solid var(--v-accent)", color: "var(--v-text)", padding: "8px 12px", borderRadius: 8, fontSize: 18, fontFamily: "Georgia, serif" }} />
                    <button onClick={async () => { await db.updateTranslation(selected.id, editTranslationVal, token); setWords(prev => prev.map(w => w.id === selected.id ? { ...w, wordSr: editTranslationVal, translation: editTranslationVal } : w)); setSelected(prev => ({ ...prev, wordSr: editTranslationVal, translation: editTranslationVal })); setEditingTranslation(false); showToast("Prevod ažuriran ✓"); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓</button>
                    <button onClick={() => setEditingTranslation(false)} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 20, color: "#c9c0b4" }}>{selected.wordSr || selected.translation}</div>
                    <button onClick={() => { setEditTranslationVal(selected.wordSr || selected.translation); setEditingTranslation(true); }} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>✎ edit</button>
                  </div>
                )}
                {selected.partOfSpeech && <div style={{ fontSize: 11, color: "var(--v-muted)", fontFamily: "monospace", marginTop: 4 }}>{selected.partOfSpeech}</div>}
              </div>
            )}
            {selected.synonyms?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.synonyms.map((syn, i) => (
                    <span key={i} onClick={e => { e.stopPropagation(); const rect = e.target.getBoundingClientRect(); setPopup({ word: syn, x: rect.left + rect.width / 2, y: rect.bottom + 8 }); }} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--v-accentSoft)", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic", cursor: "pointer" }} onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.3)"; e.target.style.borderColor = "var(--v-accent)"; }} onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = "rgba(99,102,241,0.3)"; }}>{syn}</span>
                  ))}
                </div>
              </div>
            )}
            {selected.sentences?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(selected.word, (updater) => { const newList = typeof updater === "function" ? updater(selected.sentences) : updater; setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: newList } : w)); setSelected(prev => ({ ...prev, sentences: newList })); }, selected.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid var(--v-accent)", color: regenLoading ? "var(--v-subtle)" : "var(--v-accentSoft)", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>{regenLoading ? "..." : "+ dodaj primer"}</button>
                </div>
                {selected.sentences.map((s, i) => <SentenceCard key={i} s={s} i={i} word={selected.word} onDelete={idx => { const updated = selected.sentences.filter((_, j) => j !== idx); setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: updated } : w)); setSelected(prev => ({ ...prev, sentences: updated })); }} onUpdate={(idx, updatedS) => { const updated = selected.sentences.map((x, j) => j === idx ? updatedS : x); setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: updated } : w)); setSelected(prev => ({ ...prev, sentences: updated })); }} />)}
              </div>
            )}
            <section style={{...vocabCardStyle,marginBottom:16,padding:14}}>
              <div style={{fontSize:12,color:"var(--v-muted)",marginBottom:8,fontWeight:700}}>KATEGORIJE / TAGOVI</div>
              <p style={{fontSize:12,color:"var(--v-muted)",margin:"0 0 12px"}}>Izaberi jedan ili više tagova iz Podešavanja. Tagovi se čuvaju u Supabase-u.</p>
              <details className="v93-tag-dropdown" onClick={e=>e.stopPropagation()}>
                <summary>{(wordTags[String(selected.id)]||[]).length ? `${(wordTags[String(selected.id)]||[]).length} izabranih tagova` : "Izaberi tagove..."} <span aria-hidden="true">▾</span></summary>
                <div className="v93-tag-dropdown-content">
                  {allTags.length ? allTags.map(tag=>(
                    <label key={tag} className="v93-tag-option">
                      <input type="checkbox" disabled={!insightsReady||tagSaveBusy}
                        checked={(wordTags[String(selected.id)]||[]).includes(tag)}
                        onChange={e=>{
                          const current=wordTags[String(selected.id)]||[];
                          saveWordTags(selected.id,e.target.checked?[...current,tag]:current.filter(t=>t!==tag));
                        }}/>
                      <span>{tag}</span>
                    </label>
                  )):<div style={{padding:12,fontSize:12,color:"var(--v-muted)"}}>Nema kreiranih tagova. Otvori Podešavanja da kreiraš prvi tag.</div>}
                </div>
              </details>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
                {(wordTags[String(selected.id)]||[]).map(tag=><span key={tag} className="v93-tag-chip">{tag}</span>)}
              </div>
            </section>
            {selected.notes && <div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 4, textTransform: "uppercase" }}>Beleške</div><div style={{ fontSize: 13, color: "var(--v-muted)" }}>{selected.notes}</div></div>}
            <div style={{ fontSize: 11, color: "var(--v-subtle)", fontFamily: "monospace" }}>
              Dodano: {formatDate(selected.addedAt)} · Ponovljeno: {selected.reviewCount}x
              {selected.learnedAt && <span style={{ color: "#22c55e" }}> · Naučeno: {formatDate(selected.learnedAt)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* v8 AI Learning — additional optional practice. Does not change SRS. */}
      {view === "aiLab" && (
        <main className="v8-page">
          <div className="v8-heading">
            <div><div className="v8-eyebrow">AI LEARNING · V8</div><h2>Uči kroz priče, slušanje i razgovor</h2>
              <p>Vežbe koriste reči iz tvog rečnika. AI može da pogreši — proveri neočekivane prevode. Ovi zadaci ne menjaju SRS raspored.</p></div>
            <span className="v8-chip">{aiLabPool.length} dostupnih reči</span>
          </div>
          <div className="v8-modes">
            {[["story","📖 Mini-priča","Tekst i prevod"],["cloze","✎ AI rečenice","Dopuni praznine"],["listen","🔊 Slušanje","Diktat reči"],["chat","💬 Razgovor","Engleski tutor"]].map(([mode,label,desc]) => (
              <button key={mode} onClick={() => { if (aiLabBusy) return; setAiLabMode(mode); setAiLabError(""); setAiLabChecked(false); setAiLabAnswer(""); }} className={`v8-mode ${aiLabMode === mode ? "selected" : ""}`}>
                <strong>{label}</strong><small>{desc}</small>
              </button>
            ))}
          </div>
          <div className="v8-controls">
            <label>Kategorija <select disabled={aiLabBusy} value={aiLabSelectedTag} onChange={e=>{setAiLabSelectedTag(e.target.value);setAiLabStory(null);setAiLabExercises([]);setAiLabChat([]);setAiLabListenWord(null);setAiLabError("");}}>
              <option value="all">Sve reči</option>{aiLabTags.map(tag=><option key={tag} value={tag}>{tag}</option>)}
            </select></label>
            <label>Broj reči <select disabled={aiLabBusy} value={aiLabWordCount} onChange={e=>{setAiLabWordCount(Number(e.target.value));setAiLabStory(null);setAiLabExercises([]);setAiLabChat([]);setAiLabListenWord(null);setAiLabError("");}}>
              {[3,5,8,10].map(n=><option key={n} value={n}>{n}</option>)}
            </select></label>
            <button className="v8-secondary" onClick={()=>{setAiLabSelectionSeed(n=>n+1);setAiLabStory(null);setAiLabExercises([]);setAiLabChat([]);setAiLabListenWord(null);setAiLabError("");}} disabled={aiLabBusy || aiLabPool.length<2} title="Izaberi druge reči">⇄ Promeni reči</button>
            <button className="v8-primary" onClick={() => startAiLearning(aiLabMode)} disabled={aiLabBusy || !aiLabPool.length}>
              {aiLabBusy ? "⟳ Generišem..." : aiLabMode === "story" ? "Generiši priču" : aiLabMode === "cloze" ? "Generiši zadatke" : aiLabMode === "listen" ? "Nova reč za diktat" : "Započni novi razgovor"}
            </button>
          </div>
          {aiLabError && <div className="v8-error" role="alert">{aiLabError}</div>}
          <div className="v8-focus">Reči za vežbu: {aiLabChosenWords.length ? aiLabChosenWords.map(w=>w.word).join(" · ") : "Nema reči za izabranu kategoriju"}</div>
          {aiLabMode === "story" && (
            <section className="v8-card">
              {aiLabStory ? <>
                <div className="v8-eyebrow">ORIGINALNA AI PRIČA</div><h3>{aiLabStory.title || "Your story"}</h3>
                {(aiLabStory.paragraphs || []).map((paragraph,i)=><p key={i} className="v8-story"><ClickableSentence text={paragraph} /></p>)}
                <button className="v8-secondary" onClick={()=>setAiLabShowTranslation(x=>!x)}>{aiLabShowTranslation?"Sakrij prevod":"Prikaži prevod na srpski"}</button>
                {aiLabShowTranslation && <div className="v8-translation">{aiLabStory.serbian || "Prevod nije dostupan."}</div>}
                <div className="v8-tip">Možeš da označiš nepoznatu reč u priči i dodaš je u rečnik koristeći postojeći meni.</div>
              </> : <div className="v8-empty">Klikni „Generiši priču“ da dobiješ kratak engleski tekst sa rečima iz svog rečnika.</div>}
            </section>
          )}
          {aiLabMode === "cloze" && (
            <section className="v8-card">
              {aiLabExercises.length ? (() => {
                const ex=aiLabExercises[aiLabExerciseIndex];
                if(!ex) return <div className="v8-empty">Zadaci su završeni! Generiši nove za još vežbanja.</div>;
                const ok=normalizeTestAnswer(aiLabAnswer)===normalizeTestAnswer(ex.answer);
                return <>
                  <div className="v8-eyebrow">AI REČENICA · {aiLabExerciseIndex+1}/{aiLabExercises.length}</div>
                  <h3 className="v8-question">{ex.sentence}</h3><p className="v8-tip">Pomoć: {ex.hint || "Popuni nedostajuću reč na engleskom."}</p>
                  <form onSubmit={e=>{e.preventDefault();setAiLabChecked(true);}} className="v8-answer-row">
                    <input value={aiLabAnswer} onChange={e=>setAiLabAnswer(e.target.value)} disabled={aiLabChecked} placeholder="Upiši englesku reč..." aria-label="Odgovor" />
                    {!aiLabChecked && <button className="v8-primary" disabled={!aiLabAnswer.trim()}>Proveri</button>}
                  </form>
                  {aiLabChecked && <div className="v8-feedback"><strong>{ok?"✓ Tačno!":"Tačan odgovor: "+ex.answer}</strong><p>{ex.translation || ""}</p>
                    <button className="v8-primary" onClick={()=>{setAiLabExerciseIndex(i=>i+1);setAiLabAnswer("");setAiLabChecked(false);}}>Sledeće pitanje →</button></div>}
                </>;
              })() : <div className="v8-empty">Klikni „Generiši zadatke“ za pet novih rečenica sa prazninama.</div>}
            </section>
          )}
          {aiLabMode === "listen" && (
            <section className="v8-card">
              {aiLabListenWord ? <>
                <div className="v8-eyebrow">SLUŠANJE / DIKTAT</div><h3>Poslušaj i napiši englesku reč</h3>
                <button className="v8-listen" onClick={()=>speak(aiLabListenWord.word)}>🔊 Pusti izgovor</button>
                <p className="v8-tip">Izgovor obezbeđuje tvoj browser. Može se razlikovati u zavisnosti od uređaja.</p>
                <form onSubmit={e=>{e.preventDefault();setAiLabChecked(true);}} className="v8-answer-row">
                  <input value={aiLabAnswer} onChange={e=>setAiLabAnswer(e.target.value)} disabled={aiLabChecked} placeholder="Šta si čuo?" aria-label="Diktat" />
                  {!aiLabChecked && <button className="v8-primary" disabled={!aiLabAnswer.trim()}>Proveri</button>}
                </form>
                {aiLabChecked && <div className="v8-feedback"><strong>{normalizeTestAnswer(aiLabAnswer)===normalizeTestAnswer(aiLabListenWord.word)?"✓ Tačno!":"Tačan odgovor: "+aiLabListenWord.word}</strong>
                  <p>{aiLabListenWord.wordSr || aiLabListenWord.translation}</p>
                  <button className="v8-primary" onClick={()=>{setAiLabAnswer("");setAiLabChecked(false);const options=aiLabChosenWords.filter(w=>w.id!==aiLabListenWord.id);setAiLabListenWord(options[Math.floor(Math.random()*options.length)] || aiLabListenWord);}}>Sledeća reč →</button></div>}
              </> : <div className="v8-empty">Klikni „Nova reč za diktat“, a zatim „Pusti izgovor“.</div>}
            </section>
          )}
          {aiLabMode === "chat" && (
            <section className="v8-card">
              {aiLabChat.length ? <>
                <div className="v8-eyebrow">AI RAZGOVOR · B1–B2</div>
                <div className="v8-chat-log" aria-live="polite">
                  {aiLabChat.map((m,i)=><div key={i} className={`v8-chat-bubble ${m.role === "user" ? "user" : "tutor"}`}><b>{m.role === "user" ? "Ti" : "AI tutor"}</b><p>{m.content}</p></div>)}
                </div>
                <form onSubmit={e=>{e.preventDefault();sendAiLabChat();}} className="v8-answer-row">
                  <input value={aiLabChatInput} onChange={e=>setAiLabChatInput(e.target.value)} placeholder="Odgovori na engleskom..." disabled={aiLabBusy} aria-label="Poruka tutor-u" />
                  <button className="v8-primary" disabled={aiLabBusy || !aiLabChatInput.trim()}>{aiLabBusy?"Pišem...":"Pošalji"}</button>
                </form>
                <div className="v8-tip">Razgovor se trenutno čuva samo u ovoj otvorenoj sesiji; nije trajno snimljen u Supabase.</div>
              </> : <div className="v8-empty">Klikni „Započni novi razgovor“ i vežbaj svoje reči u kratkoj konverzaciji na engleskom.</div>}
            </section>
          )}
        </main>
      )}

      {/* v6: local-only tests; never modify SRS or vocabulary */}
      {view === "test" && (
        <main className="v6-page">
          <div className="v6-heading"><div><div className="v6-eyebrow">KNOWLEDGE TESTS · V6</div><h2>Proveri koliko znaš</h2><p>Pet načina vežbanja. Rezultati se beleže u istoriju, ali ne menjaju SRS raspored.</p></div><span className="v6-chip">{words.length} reči u rečniku</span></div>
          <div className="v6-modes">
            {[
              ["typing", "✎ Engleski → srpski", "Ukucaj prevod"],
              ["reverse", "⇄ Srpski → engleski", "Seti se engleske reči"],
              ["choice", "☷ Četiri odgovora", "Izaberi prevod"],
              ["cloze", "▤ Dopuni rečenicu", "Reč u kontekstu"],
              ["mixed", "✧ Mešoviti test", "Svi načini zajedno"]
            ].map(([id, label, desc]) => <button key={id} className={`v6-mode ${testMode === id ? "selected" : ""}`} onClick={() => startKnowledgeTest(id)}><strong>{label}</strong><small>{desc}</small></button>)}
          </div>
          {testQuestions.length === 0 ? (
            <section className="v6-card v6-empty"><h3>Nema dovoljno podataka za ovaj test.</h3><p>{testMode === "choice" ? "Potrebne su najmanje četiri reči sa različitim prevodima." : testMode === "cloze" ? "Za dopunjavanje su potrebni primeri engleskih rečenica koji sadrže zadatu reč." : "Dodaj reči sa prevodom u svoj rečnik."}</p><button className="v6-main-btn" onClick={() => startKnowledgeTest("typing")}>Probaj kucanje prevoda</button></section>
          ) : testIndex >= testQuestions.length ? (
            <section className="v6-card v6-results"><div className="v6-icon">🏆</div><h3>Test završen!</h3><div className="v6-score">{testResults.filter(r => r.correct).length} / {testResults.length}</div><p>Tačno: {testResults.length ? Math.round(100 * testResults.filter(r => r.correct).length / testResults.length) : 0}%</p><div className="v6-mistakes">{testResults.filter(r => !r.correct).map(r => <div key={r.id}><b>{r.word}</b><span>Tvoj odgovor: {r.given || "(prazno)"}</span><span>Tačno: {r.expected}</span></div>)}</div><div className="v6-actions"><button className="v6-main-btn" onClick={() => startKnowledgeTest(testMode)}>Ponovi test</button><button className="v6-alt-btn" onClick={() => { setWorkspaceTab("home"); setView("list"); }}>Na početnu</button></div></section>
          ) : (() => {
            const question = testQuestions[testIndex];
            const target = question.word;
            const questionLabel = { typing: "PREVEDI NA SRPSKI", reverse: "PREVEDI NA ENGLESKI", choice: "IZABERI TAČAN PREVOD", cloze: "DOPUNI ENGLESKU REČENICU" }[question.type];
            return <section className="v6-card"><div className="v6-card-top"><span>Pitanje {testIndex + 1} od {testQuestions.length}</span><span>{questionLabel}</span></div><div className="v6-track"><div style={{ width: `${100 * (testIndex + (testFeedback ? 1 : 0)) / testQuestions.length}%` }} /></div>
              <div className="v6-prompt">{question.type === "cloze" ? <><div className="v6-context">{question.cloze.masked}</div><small>Upiši reč koja nedostaje. {question.cloze.sr ? `Prevod: ${question.cloze.sr}` : ""}</small></> : <><h3>{question.type === "reverse" ? target.wordSr || target.translation : target.word}</h3>{question.type !== "reverse" && <button onClick={() => speak(target.word)} className="v6-audio">🔊 Poslušaj izgovor</button>}</> }</div>
              {question.type === "choice" ? <div className="v6-options">{question.options.map(option => <button key={option} disabled={Boolean(testFeedback)} className={`v6-option ${testFeedback && normalizeTestAnswer(option) === normalizeTestAnswer(target.wordSr || target.translation) ? "correct" : ""} ${testFeedback && testFeedback.given === option && !testFeedback.correct ? "wrong" : ""}`} onClick={() => submitKnowledgeAnswer(option)}>{option}</button>)}</div> : <form className="v6-form" onSubmit={e => { e.preventDefault(); submitKnowledgeAnswer(); }}><label htmlFor="v6-answer">Tvoj odgovor</label><input id="v6-answer" value={testInput} onChange={e => setTestInput(e.target.value)} disabled={Boolean(testFeedback)} autoComplete="off" placeholder={question.type === "typing" ? "Unesi srpski prevod..." : "Unesi englesku reč..."}/>{!testFeedback && <button type="submit" className="v6-main-btn" disabled={!testInput.trim()}>Proveri odgovor</button>}</form>}
              {testFeedback && <div className={`v6-feedback ${testFeedback.correct ? "yes" : "no"}`}><b>{testFeedback.correct ? "✓ Tačno!" : "✕ Nije tačno"}</b><span>Tačan odgovor: <strong>{testFeedback.expected}</strong></span>{question.type === "cloze" && <small>{question.cloze.full}</small>}</div>}
              <div className="v6-card-footer"><span><b>{testResults.filter(r => r.correct).length}</b> tačnih · <b>{testResults.filter(r => !r.correct).length}</b> netačnih</span>{testFeedback && <button className="v6-main-btn" onClick={nextKnowledgeQuestion}>{testIndex === testQuestions.length - 1 ? "Vidi rezultate →" : "Sledeće pitanje →"}</button>}</div>
            </section>;
          })()}
          <div className="v6-note">✧ v7: Završeni testovi se čuvaju u Supabase-u (posle poslednjeg pitanja); odgovori ne menjaju status reči ni SRS interval.</div>
        </main>
      )}

      {view === "settings" && (
        <main className="v93-settings-page">
          <div className="v93-settings-header">
            <div><div style={{fontSize:11,letterSpacing:2,color:"var(--v-accent)",fontWeight:800}}>OPŠTA PODEŠAVANJA</div>
              <h2 style={{margin:"8px 0 6px",fontSize:28}}>Podešavanja</h2>
              <p style={{margin:0,color:"var(--v-muted)"}}>Upravljaj dozvoljenim tagovima za svoj rečnik. Novi tagovi mogu se kreirati samo ovde.</p>
            </div>
          </div>
          <section className="v93-settings-card">
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
              <h3 style={{margin:0,fontSize:20}}>Katalog tagova</h3>
              <span style={{color:"var(--v-muted)",fontSize:13}}>{allTags.length} tagova</span>
            </div>
            <p style={{fontSize:13,color:"var(--v-muted)",lineHeight:1.6}}>Na primer: IT, Business, Everyday, Phrasal verbs. Jednoj reči možeš dodeliti više tagova.</p>
            <form className="v93-settings-create" onSubmit={createCatalogTag}>
              <input aria-label="Naziv novog taga" maxLength={40} placeholder="Naziv novog taga..." value={newCatalogTag} onChange={e=>setNewCatalogTag(e.target.value)} />
              <button disabled={!insightsReady||catalogSaving||!newCatalogTag.trim()} type="submit">+ Kreiraj tag</button>
            </form>
            {!insightsReady&&<p style={{color:"#d97706",fontSize:13}}>{insightsError||"Učitavam tagove..."}</p>}
            <div className="v93-settings-tags">
              {allTags.map(tag=>{
                const usage=words.filter(w=>(wordTags[String(w.id)]||[]).includes(tag)).length;
                return <div className="v93-settings-tag" key={tag}>
                  <div><strong>{tag}</strong><small>{usage} {usage===1?"reč":"reči"}</small></div>
                  <button type="button" title={usage?"Prvo ukloni ovaj tag sa reči":"Obriši neiskorišćen tag"} disabled={catalogSaving||usage>0} onClick={()=>removeCatalogTag(tag)}>Obriši</button>
                </div>;
              })}
              {!allTags.length&&<div style={{color:"var(--v-muted)",padding:12}}>Još nema definisanih tagova.</div>}
            </div>
            <p style={{fontSize:12,color:"var(--v-muted)",marginBottom:0}}>Tag se može obrisati samo ako nije dodeljen nijednoj reči, radi zaštite postojećih oznaka. Već korišćeni tag možeš ukloniti u detaljima pojedinačne reči.</p>
          </section>
        </main>
      )}

      {view === "insights" && <main style={{maxWidth:1080,margin:"0 auto",padding:"24px",display:"grid",gap:18}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}><div><div style={{fontSize:11,color:"var(--v-accent)",letterSpacing:2}}>INSIGHTS & ORGANIZATION · V7</div><h2 style={{margin:"7px 0"}}>Statistika učenja</h2><p style={{margin:0,color:"var(--v-muted)"}}>Istorija SRS ponavljanja i završenih testova — bez menjanja postojećih ocena.</p></div><select aria-label="Period statistike" value={insightsRange} onChange={e=>setInsightsRange(Number(e.target.value))} style={{background:"var(--v-input)",color:"var(--v-text)",border:"1px solid var(--v-border)",padding:12,borderRadius:10}}><option value={7}>7 dana</option><option value={14}>14 dana</option><option value={30}>30 dana</option></select></div>
        {!insightsReady&&<div style={{...vocabCardStyle,color:"#d97706"}}>⚠ {insightsError||"Učitavam statistiku..."}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:12}}>{[["Pokušaji",recentAttempts.length],["Tačno",correctAttempts],["Uspešnost",recentAttempts.length?Math.round(correctAttempts/recentAttempts.length*100)+"%":"—"],["SRS ponavljanja",recentAttempts.filter(r=>r.mode==="SRS").length],["Test pitanja",recentAttempts.filter(r=>r.mode!=="SRS").length]].map(([label,value])=><div key={label} style={vocabCardStyle}><div style={{fontSize:12,color:"var(--v-muted)"}}>{label}</div><strong style={{display:"block",fontSize:28,marginTop:8,color:"var(--v-accent)"}}>{value}</strong></div>)}</div>
        <section style={vocabCardStyle}><h3 style={{marginTop:0}}>Aktivnost po danima</h3><div style={{display:"flex",gap:5,alignItems:"end",overflowX:"auto",minHeight:180,paddingTop:10}}>{dailyInsights.map(day=><div key={day.key} title={`${day.label}: ${day.correct} tačno, ${day.wrong} netačno`} style={{flex:"1 0 18px",minWidth:18,textAlign:"center"}}><div style={{display:"flex",flexDirection:"column",justifyContent:"end",height:115,borderBottom:"1px solid var(--v-border)"}}><div style={{height:`${Math.min(100,day.wrong*7)}%`,background:"#e11d48",borderRadius:"4px 4px 0 0",minHeight:day.wrong?3:0}}/><div style={{height:`${Math.min(100,day.correct*7)}%`,background:"#22a36a",minHeight:day.correct?3:0}}/></div><small style={{fontSize:9,color:"var(--v-muted)"}}>{day.label}</small></div>)}</div><p style={{fontSize:12,color:"var(--v-muted)"}}>🟩 Tačno / Znam &nbsp; 🟥 Netačno / Teško / Ne znam. Visina je ilustrativno ograničena za velike vrednosti.</p></section>
        <section style={vocabCardStyle}><h3 style={{marginTop:0}}>Reči sa najviše grešaka</h3>{hardestWords.length===0?<p style={{color:"var(--v-muted)"}}>Za ovaj period nema zabeleženih grešaka.</p>:hardestWords.map((item,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",borderBottom:"1px solid var(--v-border)",padding:"9px 0",gap:12}}><strong>{item.word}</strong><span style={{color:"var(--v-muted)"}}>{item.wrong} grešaka / {item.total} pokušaja</span></div>)}</section>
        <section style={vocabCardStyle}><h3 style={{marginTop:0}}>Kategorije i tagovi</h3><p style={{color:"var(--v-muted)",fontSize:13}}>Tagovi se kreiraju u Podešavanjima, a dodeljuju rečima u njihovim detaljima.</p><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{allTags.length?allTags.map(tag=><button key={tag} onClick={()=>{setTagFilter(tag);setWorkspaceTab("dictionary");setView("list");}} style={{background:"var(--v-elevated)",color:"var(--v-text)",border:"1px solid var(--v-border)",borderRadius:20,padding:"8px 13px",cursor:"pointer"}}>{tag} ({words.filter(w=>(wordTags[String(w.id)]||[]).includes(tag)).length})</button>):<span style={{color:"var(--v-muted)"}}>Još nema tagova.</span>}</div></section>
      </main>}

      {/* PRACTICE — v5.1 screenshot-inspired responsive dashboard */}
      {view === "review" && (
        <main className="vocab-practice-page" style={{ maxWidth: 1530, margin: "0 auto", padding: "22px 18px 56px", boxSizing: "border-box" }}>
          <div className="v51-modes">
            <div className="v51-mode-buttons">
              <button onClick={() => startPractice("smart")} disabled={!srsReady} className={`v51-mode ${practiceMode === "smart" ? "active" : ""}`} style={{ opacity: srsReady ? 1 : .5 }}>♧ &nbsp; Pametno ponavljanje ({srsReady ? dueWords.length : "—"})</button>
              <button onClick={() => startPractice("free")} className={`v51-mode ${practiceMode === "free" ? "active" : ""}`}>⤨ &nbsp; Slobodno vežbanje ({words.length})</button>
            </div>
            <div className="v51-goal-controls">
              <label htmlFor="v51-daily-goal">◎ &nbsp; Dnevni cilj:</label>
              <select id="v51-daily-goal" value={dayGoal} onChange={e => { const n = Number(e.target.value); setDayGoal(n); localStorage.setItem("vocab_daily_goal", String(n)); }}>
                {[10,15,20,30,50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="v51-top-progress"><span style={{ width: `${Math.min(100, todaysReviews.length / dayGoal * 100)}%` }} /></div>
              <strong>{todaysReviews.length} / {dayGoal} ({Math.min(100, Math.round(todaysReviews.length / dayGoal * 100))}%)</strong>
            </div>
          </div>
          {srsError && <div role="alert" style={{ border: "1px solid var(--v-dangerBorder)", background: "var(--v-dangerBg)", borderRadius: 12, padding: 14, marginBottom: 20 }}>Smart Learning još nije aktivan: {srsError}. Slobodno vežbanje je dostupno.</div>}
          <div className="v51-practice-grid">
            <aside className="v51-pane v51-left">
              <div className="v51-pane-title"><span className="v51-icon">▦</span><span><b>Današnje vežbanje</b><small>Reči koje je vreme da ponoviš</small></span></div>
              {[
                ["↻", "Za ponavljanje danas", srsReady ? dueWords.length : "—", "blue"],
                ["✓", "Odrađeno danas", srsReady ? todaysReviews.length : "—", "green"],
                ["◎", "Dnevni cilj", dayGoal, "purple"]
              ].map(([icon,label,value,color]) => <div className="v51-stat" key={label}><span className={`v51-stat-icon ${color}`}>{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>)}
              <div className="v51-progress-section">
                <div className="v51-progress-head"><b>Napredak danas</b><strong>{Math.min(100, Math.round(todaysReviews.length / dayGoal * 100))}%</strong></div>
                <div className="v51-progress-bar"><span style={{ width: `${Math.min(100, todaysReviews.length / dayGoal * 100)}%` }} /></div>
              </div>
              <div className="v51-next-date"><span className="v51-icon">▦</span><span><b>Sledeće ponavljanje</b><small>{(() => { const dates = Object.values(srsSchedules).map(s => s.due_at && new Date(s.due_at).getTime()).filter(n => Number.isFinite(n) && n > Date.now()).sort((a,b) => a-b); return !srsReady ? "Aktiviraj Smart Learning" : dates.length ? new Date(dates[0]).toLocaleDateString("sr-RS", {day:"numeric",month:"short"}) : "Nema zakazanih reči"; })()}</small></span></div>
            </aside>
            <section className="v51-middle">
              {!currentReview ? (
                <div className="v51-flashcard v51-finished"><div className="v51-finished-emoji">🎉</div><h2>Sesija završena!</h2><p>{practiceMode === "smart" ? "Sve trenutno dospele reči su obrađene ili preskočene u ovoj sesiji. Preskočene reči ostaju dospele." : "Nema reči u rečniku."}</p><button className="v51-primary" onClick={() => startPractice(practiceMode)}>Nova sesija</button><button className="v51-outline" onClick={() => {setWorkspaceTab("dictionary");setView("list");}}>Otvori rečnik</button></div>
              ) : (
                <div className="v51-flashcard">
                  <div className="v51-card-top"><span className="v51-counter">{practiceMode === "smart" ? sessionReviewed.length + 1 : reviewIndex + 1} / {practiceMode === "smart" ? sessionReviewed.length + reviewWords.length : reviewWords.length}</span><span className="v51-card-mode">{practiceMode === "smart" ? "Pametno ponavljanje" : "Slobodno vežbanje"}</span><span title={`Status: ${statusLabel(currentReview.status)}`} className="v51-star">☆</span></div>
                  <div className="v51-word"><div className="v51-word-line"><h2>{currentReview.word}</h2><button onClick={() => speak(currentReview.word)} className="v51-sound" aria-label="Izgovori reč" title="Izgovori reč">◖))</button></div>{currentReview.ipa && <div className="v51-ipa">{currentReview.ipa}</div>}</div>
                  {!revealed ? <div className="v51-question"><p>Kako se prevodi na srpski?</p><button className="v51-reveal" onClick={() => setRevealed(true)}>Prikaži odgovor</button></div> : <div className="v51-revealed"><div className="v51-answer">✓ &nbsp; {currentReview.wordSr || currentReview.translation || "Nema prevoda"}</div>{currentReview.sentences?.[0] && <div className="v51-example"><span>❞</span><div><strong>Primer:</strong><div className="v51-example-en">{currentReview.sentences[0].en || currentReview.sentences[0]}</div>{currentReview.sentences[0].sr && <small>{currentReview.sentences[0].sr}</small>}</div></div>}<div className="v51-rating-grid"><button onClick={() => practiceRate("again")} disabled={srsSaving} className="v51-rating bad"><b>✕ &nbsp; Ne znam</b><small>{practiceMode === "smart" ? "Ponovo za 10 min" : "Sledeća reč"}</small></button><button onClick={() => practiceRate("hard")} disabled={srsSaving} className="v51-rating hard"><b>▥ &nbsp; Teško</b><small>{practiceMode === "smart" ? "Ponovo za 1 dan" : "Sledeća reč"}</small></button><button onClick={() => practiceRate("known")} disabled={srsSaving} className="v51-rating good"><b>✓ &nbsp; Znam</b><small>{practiceMode === "smart" ? "Duži interval" : "Sledeća reč"}</small></button></div></div>}
                  <div className="v51-card-bottom"><button onClick={() => speak(currentReview.word)}>◖)) &nbsp; Izgovor</button><button onClick={practiceAdvance}>⏭ &nbsp; Preskoči</button><button onClick={() => { setPracticeShuffle(v => !v);setReviewIndex(0);setRevealed(false); }}>⤨ &nbsp; {practiceShuffle ? "Redom" : "Nasumično"}</button></div>
                </div>
              )}
              <div className="v51-below-card"><button onClick={() => { setReviewIndex(i => reviewWords.length ? (i - 1 + reviewWords.length) % reviewWords.length : 0); setRevealed(false); }} disabled={practiceMode === "smart" || reviewWords.length < 2}>← &nbsp; Prethodna</button><div className="v51-dots">{Array.from({length:Math.min(11,Math.max(1,reviewWords.length))},(_,i)=><i key={i} className={i === (reviewIndex % Math.max(1,reviewWords.length)) ? "on" : ""} />)}</div><button onClick={practiceAdvance} disabled={!currentReview}>Sledeća &nbsp; →</button></div>
            </section>
            <aside className="v51-pane v51-right">
              <div className="v51-pane-title"><span className="v51-icon">▱</span><span><b>Sledeće na redu</b><small>Narednih 5 reči za vežbanje</small></span></div>
              {reviewWords.length < 2 ? <p className="v51-empty">Trenutno nema narednih reči.</p> : Array.from({length:Math.min(5,reviewWords.length-1)},(_,i)=>{const idx=(reviewIndex+i+1)%reviewWords.length;const w=reviewWords[idx];return <button className="v51-queue-row" key={w.id} onClick={()=>{setReviewIndex(idx);setRevealed(false);}}><span className="v51-queue-num">{i+1}</span><span className="v51-queue-label"><b>{w.word}</b><small>{w.ipa || " "}</small></span><span className={`v51-status ${w.status}`}>{statusLabel(w.status)}</span></button>;})}
            </aside>
          </div>
          <div className="v51-explanation"><div><span className="v51-icon">♧</span><span><b>Smart Learning (SRS)</b><small>{practiceMode === "smart" ? "Aplikacija određuje naredno ponavljanje na osnovu tvojih odgovora." : "Slobodno vežbanje ne menja raspored, statuse ni istoriju u Supabase-u."}</small></span></div><div><b>Raspored ponavljanja:</b><span><em>✕ Ne znam – 10 min</em><em>◔ Teško – 1 dan</em><em>✓ Znam – sve duži intervali</em></span></div></div>
        </main>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ padding: 24, paddingBottom: 42, maxWidth: 1080, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          {workspaceTab === "home" && (
            <section className="v9-dashboard" style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                  <div style={{ color: "var(--v-accentSoft)", fontSize: 11, letterSpacing: 2, fontFamily: "monospace", textTransform: "uppercase", marginBottom: 6 }}>Tvoj prostor za učenje</div>
                  <h2 style={{ fontSize: 28, margin: 0, lineHeight: 1.2, fontWeight: 600 }}>Dobrodošao nazad! 👋</h2>
                  <p style={{ margin: "8px 0 0", color: "var(--v-muted)", fontSize: 13 }}>Nastavi sa učenjem i ostvari svoj današnji cilj.</p>
                </div>
                <button onClick={() => setWorkspaceTab("dictionary")} style={{ border: "1px solid var(--v-border)", background: "var(--v-panel)", color: "var(--v-text)", padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Otvori rečnik →</button>
              </div>
              <div className="vocab-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: 14 }}>
                {[["Sve reči", counts.all, "var(--v-accent)"], ["Novo", counts.new, "#3b82f6"], ["Učim", counts.learning, "#e11d48"], ["Znam", counts.known, "#22a36a"]].map(([label, value, color]) => (
                  <div key={label} style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 16, padding: "17px 18px", boxShadow: "0 3px 12px rgba(0,0,0,0.025)" }}>
                    <div style={{ fontSize: 12, color: "var(--v-muted)", marginBottom: 9 }}>{label}</div>
                    <div style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div className="vocab-hero-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(250px,1fr)", gap: 14 }}>
                <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 17, padding: 22 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "var(--v-accentSoft)", marginBottom: 12 }}>Vežbanje</div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 21 }}>Dnevni cilj i ponavljanje</h3>
                  <p style={{ fontSize: 13, color: "var(--v-muted)", lineHeight: 1.5, margin: "0 0 20px" }}>{srsReady ? `Danas je dospelo ${dueWords.length} reči. Već imaš ${todaysReviews.length} ponavljanja, od cilja ${dayGoal}.` : "Aktiviraj Smart Learning SQL skriptom ili nastavi sa slobodnim vežbanjem."}</p>
                  <button disabled={!words.length} onClick={() => startPractice(srsReady ? "smart" : "free")}
                    style={{ background: "var(--v-accent)", color: "var(--v-accentText)", border: "none", padding: "12px 18px", borderRadius: 10, cursor: words.length ? "pointer" : "default", opacity: words.length ? 1 : 0.5, fontWeight: 700, fontSize: 13 }}>▶ {srsReady ? "Pametno ponavljanje" : "Slobodno vežbanje"}</button>
                </div>
                <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 17, padding: 22 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "var(--v-accentSoft)", marginBottom: 12 }}>Napredak rečnika</div>
                  <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 10 }}>{counts.all ? Math.round(counts.known / counts.all * 100) : 0}% <span style={{ fontWeight: 400, fontSize: 13, color: "var(--v-muted)" }}>u statusu Znam</span></div>
                  <div style={{ height: 9, background: "var(--v-elevated)", overflow: "hidden", borderRadius: 20, marginBottom: 12 }}><div style={{ width: `${counts.all ? counts.known / counts.all * 100 : 0}%`, height: "100%", background: "#22a36a", borderRadius: 20 }} /></div>
                  <div style={{ color: "var(--v-muted)", fontSize: 12, lineHeight: 1.6 }}>Statusi reči ostaju ručni. {srsReady ? `Danas: ${todaysReviews.length} ocena · ${todayCorrect} puta „Znam“. Sledeći termin svake reči čuva se u Supabase-u.` : "Za istoriju i raspored uradi SQL migraciju."}</div>
                </div>
              </div>
              <div className="v9-overview-insights">
                <div className="v9-overview-chart">
                  <div className="v9-overview-title">Tvoj napredak <span>poslednjih 7 dana</span></div>
                  <div className="v9-mini-bars">
                    {dailyInsights.slice(-7).map((day) => (
                      <div className="v9-mini-bar-column" key={day.key} title={`${day.label}: ${day.correct} uspešnih od ${day.correct + day.wrong} odgovora`}>
                        <div className="v9-mini-bar-track"><span style={{ height: `${Math.max(3, Math.min(100, (day.correct + day.wrong) * 8))}%` }} /></div>
                        <small>{day.label.slice(0, 2)}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="v9-overview-success">
                  <div className="v9-overview-title">Uspešnost <span>evidentirani odgovori</span></div>
                  <div className="v9-donut" style={{ background: `conic-gradient(#25aa68 0 ${recentAttempts.length ? Math.round(correctAttempts / recentAttempts.length * 100) : 0}%, var(--v-elevated) 0 100%)` }}><div>{recentAttempts.length ? `${Math.round(correctAttempts / recentAttempts.length * 100)}%` : "—"}</div></div>
                  <small>{recentAttempts.length} pokušaja u izabranom periodu</small>
                </div>
              </div>
              <div className="v9-dashboard-actions">
                <button onClick={() => startPractice(srsReady ? "smart" : "free")}>▶ &nbsp; Nastavi vežbanje</button>
                <button onClick={() => startKnowledgeTest()}>▤ &nbsp; Pokreni test</button>
                <button onClick={() => { setView("aiLab"); setAiLabError(""); }}>✦ &nbsp; AI učenje</button>
                <button onClick={() => setView("insights")}>▥ &nbsp; Pregled statistike</button>
              </div>
            </section>
          )}
          {workspaceTab === "home" && (
            <section className="v9-recent" style={{ marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <div><h2 style={{ fontSize: 23, margin: "0 0 5px" }}>Nedavno dodate reči</h2><div style={{ fontSize: 13, color: "var(--v-muted)" }}>Brzi pregled, bez prikazivanja celog rečnika</div></div>
                <button onClick={() => setWorkspaceTab("dictionary")} style={{ border: "1px solid var(--v-border)", background: "var(--v-panel)", borderRadius: 9, color: "var(--v-text)", padding: "9px 13px", cursor: "pointer" }}>Sve reči →</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 10 }}>
                {[...words].sort((a,b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0)).slice(0,6).map(w => (
                  <button key={w.id} onClick={() => { setSelected(w); setView("detail"); fetchImage(w.word,w.imageUrl,w.id); }} style={{ background: "var(--v-panel)", color: "var(--v-text)", border: "1px solid var(--v-border)", borderLeft: `4px solid ${statusDot(w.status)}`, textAlign: "left", borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
                    <div style={{ fontSize: 17, fontStyle: "italic", fontWeight: 700, marginBottom: 5 }}>{w.word}</div>
                    <div style={{ fontSize: 13, color: "var(--v-muted)" }}>{w.translation}</div>
                  </button>
                ))}
              </div>
            </section>
          )}
          {workspaceTab === "dictionary" && (<><div className="v9-dictionary">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22 }}>Moj rečnik</h2>
              <div style={{ color: "var(--v-muted)", fontSize: 12, marginTop: 4 }}>{filteredWords.length} prikazanih od ukupno {words.length} reči</div>
            </div>

          </div>
          <div className="v9-dictionary-filters" aria-label="Filtriraj reči po statusu">
            {[["all", "Sve"], ["new", "Novo"], ["learning", "Učim"], ["known", "Znam"]].map(([key, label]) => (
              <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                {label} <span>{counts[key]}</span>
              </button>
            ))}
            <button className="v9-new-word" onClick={() => { setView("add"); setWordInput(""); setAiData(null); setNotes(""); }}>+ Dodaj reč</button>
          </div>
          {/* Actions bar */}
          <div className="vocab-toolbar" style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18, flexWrap: "wrap", background: "var(--v-panel)", padding: 10, border: "1px solid var(--v-border)", borderRadius: 14 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="⌕  Pretraži reči..." style={{ flex: "1 1 230px", minWidth: 150, background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 13px", borderRadius: 9, fontSize: 13, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
            <select value={sortOrder} onChange={e => { setSortOrder(e.target.value); localStorage.setItem("vocab_sort", e.target.value); }} aria-label="Sortiraj reči" title="Sortiraj reči"
              style={{ background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12, maxWidth: "100%" }}>
              <option value="newest">↓ Najnovije</option><option value="oldest">↑ Najstarije</option><option value="az">A–Z</option><option value="za">Z–A</option>
            </select>
            <select value={tagFilter} onChange={e=>setTagFilter(e.target.value)} aria-label="Filter po tagu" style={{background:"var(--v-input)",color:"var(--v-text)",border:"1px solid var(--v-border)",borderRadius:9,padding:"10px 12px"}}><option value="all">Svi tagovi</option>{allTags.map(tag=><option key={tag} value={tag}>{tag}</option>)}</select>
            <button onClick={exportVocabCsv} style={{background:"var(--v-input)",color:"var(--v-text)",border:"1px solid var(--v-border)",borderRadius:9,padding:"10px 12px",cursor:"pointer"}}>↓ CSV / Excel</button>
            <label style={{background:"var(--v-input)",color:"var(--v-text)",border:"1px solid var(--v-border)",borderRadius:9,padding:"10px 12px",cursor:"pointer",fontSize:12}}>↑ Uvezi CSV<input type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>{importVocabFile(e.target.files?.[0]);e.target.value="";}} /></label>
            {filteredWords.length > 0 && <button onClick={exportPDF} title="Izvezi PDF" style={{ background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 13px", borderRadius: 9, cursor: "pointer", fontSize: 12 }}>↓ PDF</button>}
            <button onClick={() => { setCombineMode(!combineMode); setSelectedIds([]); setCombineResult(null); }} style={{ background: combineMode ? "var(--v-accent)" : "var(--v-input)", border: "1px solid var(--v-border)", color: combineMode ? "var(--v-accentText)" : "var(--v-text)", padding: "11px 13px", borderRadius: 9, cursor: "pointer", fontSize: 12 }}>⊕ Kombiniraj</button>
            <div style={{ display: "flex", background: "var(--v-input)", border: "1px solid var(--v-border)", borderRadius: 9, overflow: "hidden", marginLeft: "auto" }}>
              <button onClick={() => {setLayoutView("list");localStorage.setItem("vocab_layout_view","list");}} title="Lista" aria-label="Prikaži listu" style={{ background: layoutView === "list" ? "var(--v-elevated)" : "transparent", border: "none", color: "var(--v-text)", padding: "10px 12px", cursor: "pointer" }}>☰</button>
              <button onClick={() => {setLayoutView("board");localStorage.setItem("vocab_layout_view","board");}} title="Board" aria-label="Prikaži board" style={{ background: layoutView === "board" ? "var(--v-elevated)" : "transparent", border: "none", color: "var(--v-text)", padding: "10px 12px", cursor: "pointer" }}>⊞</button>
              <button onClick={() => {setLayoutView("mosaic");localStorage.setItem("vocab_layout_view","mosaic");}} title="Mozaik reči" aria-label="Prikaži mozaik reči" style={{background:layoutView==="mosaic"?"var(--v-elevated)":"transparent",border:"none",color:"var(--v-text)",padding:"10px 12px",cursor:"pointer"}}>▦</button>
            </div>
          </div>

          {(importNotice || importRows.length>0) && <div style={{...vocabCardStyle,marginBottom:18}}><strong>CSV uvoz</strong><p style={{color:"var(--v-muted)"}}>{importNotice}</p>{importRows.length>0&&<><p>Primer prvih 5: {importRows.slice(0,5).map(r=>r.word).join(", ")}</p><button onClick={commitVocabImport} disabled={importBusy} style={{background:"var(--v-accent)",color:"var(--v-accentText)",padding:"10px 18px",border:0,borderRadius:9,cursor:"pointer"}}>{importBusy?"Uvozim...":`Potvrdi uvoz (${importRows.length})`}</button></>}</div>}
          {/* Combine result */}
          {combineResult && (
            <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-accent)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 12, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                Kombinovani primeri — {combineResult.words.map(w => <span key={w} style={{ background: "rgba(99,102,241,0.2)", padding: "2px 8px", borderRadius: 10, fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>{w}</span>)}
              </div>
              {combineResult.sentences.map((s, i) => (
                <div key={i} style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid var(--v-accent)", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, color: "var(--v-text)", lineHeight: 1.6, marginBottom: 3, display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ flex: 1 }}>{(() => { let parts = [s.en]; combineResult.words.forEach(word => { parts = parts.flatMap(part => { if (typeof part !== "string") return [part]; const split = part.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")); return split.map((p, j) => p.toLowerCase() === word.toLowerCase() ? <strong key={word+j} style={{ color: "#fff", fontWeight: 700 }}>{p}</strong> : p); }); }); return parts; })()}</span>
                    <button onClick={() => speak(s.en)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
                  </div>
                  {s.sr && <div style={{ fontSize: 12, color: "var(--v-muted)", fontStyle: "italic", marginBottom: 8 }}>↳ {s.sr}</div>}
                  {savingTo?.sentenceIndex === i ? (
                    <div style={{ background: "var(--v-input)", border: "1px solid var(--v-border)", borderRadius: 8, padding: "10px 12px", marginTop: 6 }}>
                      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Dodaj primer za:</div>
                      {combineResult.words.map(word => { const wordObj = words.find(w => w.word === word); const checked = savingTo.selectedWordIds.includes(wordObj?.id); return wordObj ? (<div key={word} onClick={() => setSavingTo(prev => ({ ...prev, selectedWordIds: checked ? prev.selectedWordIds.filter(id => id !== wordObj.id) : [...prev.selectedWordIds, wordObj.id] }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer" }}><div style={{ width: 16, height: 16, borderRadius: 3, border: "2px solid " + (checked ? "var(--v-accent)" : "rgba(255,255,255,0.3)"), background: checked ? "var(--v-accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{checked ? "✓" : ""}</div><span style={{ fontSize: 13, fontStyle: "italic", color: "var(--v-text)" }}>{word}</span><span style={{ fontSize: 11, color: "var(--v-muted)" }}>{wordObj.translation}</span></div>) : null; })}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => { savingTo.selectedWordIds.forEach(wid => { setWords(prev => prev.map(w => w.id === wid ? { ...w, sentences: [...(w.sentences || []), { en: s.en, sr: s.sr }] } : w)); }); showToast(`Primer dodat ✓`); setSavingTo(null); }} disabled={savingTo.selectedWordIds.length === 0} style={{ background: savingTo.selectedWordIds.length > 0 ? "var(--v-accent)" : "var(--v-border)", border: "none", color: savingTo.selectedWordIds.length > 0 ? "#fff" : "var(--v-muted)", padding: "6px 14px", borderRadius: 6, cursor: savingTo.selectedWordIds.length > 0 ? "pointer" : "default", fontSize: 12, fontFamily: "monospace" }}>Sačuvaj</button>
                        <button onClick={() => setSavingTo(null)} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Odustani</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setSavingTo({ sentenceIndex: i, selectedWordIds: [] })} style={{ background: "none", border: "1px solid rgba(99,102,241,0.4)", color: "var(--v-accentSoft)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>+ sačuvaj primer</button>
                  )}
                </div>
              ))}
              <button onClick={() => setCombineResult(null)} style={{ background: "none", border: "none", color: "var(--v-muted)", cursor: "pointer", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>✕ zatvori</button>
            </div>
          )}

          {/* MOSAIC VIEW — v9.2 */}
          {layoutView === "mosaic" && <WordMosaic words={filteredWords} srsHistory={srsHistory} testHistory={testHistory} srsSchedules={srsSchedules}
            combineMode={combineMode} selectedIds={selectedIds}
            onToggleSelection={id=>setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
            onOpen={w=>{setSelected(w);setView("detail");fetchImage(w.word,w.imageUrl,w.id);}} />}

          {/* BOARD VIEW */}
          {layoutView === "board" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, alignItems: "start" }}>
              {[["new","★ Novo","#3b82f6","rgba(59,130,246,0.08)"],["learning","? Učim","#e11d48","rgba(225,29,72,0.08)"],["known","✓ Znam","#22c55e","rgba(34,197,94,0.08)"]].map(([status, label, color, bg]) => {
                const col = searchedWords.filter(w => w.status === status);
                return (
                  <div key={status} style={{ background: bg, border: "1px solid " + color + "33", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid " + color + "33", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: color, letterSpacing: 1 }}>{label}</span>
                      <span style={{ fontSize: 11, background: color + "22", color: color, borderRadius: 10, padding: "2px 8px", fontFamily: "monospace" }}>{col.length}</span>
                    </div>
                    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6, minHeight: 60 }}>
                      {col.length === 0 && <div style={{ color: "var(--v-subtle)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>—</div>}
                      {col.map(w => (
                        <div key={w.id} onClick={() => { setSelected(w); setView("detail"); fetchImage(w.word, w.imageUrl, w.id); }}
                          style={{ background: "var(--v-card)", border: "1px solid var(--v-border)", borderRadius: 8, padding: "10px 12px", cursor: "pointer", transition: "border-color 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = color + "88"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = "var(--v-border)"}>
                          <div style={{ fontSize: 14, fontStyle: "italic", color: "var(--v-text)", fontWeight: "bold", marginBottom: 2 }}>{w.word}</div>
                          {w.ipa && <div style={{ fontSize: 11, color: "var(--v-accent)", fontFamily: "monospace", marginBottom: 3 }}>{w.ipa}</div>}
                          {w.translation && <div style={{ fontSize: 12, color: "var(--v-muted)" }}>{w.translation}</div>}
                        {(wordTags[String(w.id)]||[]).length>0&&<div style={{display:"flex",gap:5,marginTop:5,flexWrap:"wrap"}}>{wordTags[String(w.id)].map(tag=><span key={tag} style={{fontSize:10,background:"var(--v-elevated)",color:"var(--v-accentSoft)",padding:"2px 7px",borderRadius:10}}>{tag}</span>)}</div>}
                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            {[["★","new","#3b82f6"],["?","learning","#e11d48"],["✓","known","#22c55e"]].map(([lbl, s, c]) => (
                              <button key={s} onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }}
                                style={{ background: w.status === s ? c : "transparent", border: "1px solid " + (w.status === s ? c : "rgba(255,255,255,0.15)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.2)", width: 22, height: 22, borderRadius: "50%", cursor: "pointer", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{lbl}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* LIST VIEW */}
          {layoutView === "list" && (
            filteredWords.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--v-muted)", padding: 60 }}><div style={{ fontSize: 40, marginBottom: 16 }}>📖</div><div>Nema reči. Klikni + DODAJ!</div></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredWords.map(w => (
                  <div key={w.id} onClick={() => { if (combineMode) { setSelectedIds(prev => prev.includes(w.id) ? prev.filter(id => id !== w.id) : [...prev, w.id]); } else { setSelected(w); setView("detail"); fetchImage(w.word, w.imageUrl, w.id); } }}
                    style={{ background: combineMode && selectedIds.includes(w.id) ? "var(--v-selectedBg)" : "var(--v-card)", border: "1px solid var(--v-border)", borderLeft: "4px solid " + (combineMode && selectedIds.includes(w.id) ? "var(--v-accent)" : w.status === "known" ? "#22c55e" : w.status === "learning" ? "#e11d48" : "#3b82f6"), borderRadius: 12, padding: "12px 16px", cursor: "pointer", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: 10, boxShadow: combineMode && selectedIds.includes(w.id) ? "0 0 16px rgba(129,140,248,0.4)" : "none", transition: "all 0.15s" }}
                    onMouseEnter={e => { if (!combineMode) e.currentTarget.style.opacity = "0.9"; }} onMouseLeave={e => { if (!combineMode) e.currentTarget.style.opacity = "1"; }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0, flex: 1, minWidth: 0 }}>
                      {combineMode && <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid " + (selectedIds.includes(w.id) ? "#818cf8" : "rgba(255,255,255,0.3)"), background: selectedIds.includes(w.id) ? "var(--v-accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: "#fff" }}>{selectedIds.includes(w.id) ? "✓" : ""}</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                          <div style={{ fontSize: 17, fontStyle: "italic", fontWeight: 700, color: "var(--v-text)" }}>{w.word}</div>
                          {w.ipa && <div style={{ fontSize: 10, color: "var(--v-muted)", fontFamily: "monospace" }}>{w.ipa}</div>}
                        </div>
                        {w.translation && <div style={{ fontSize: 12, color: "var(--v-muted)" }}>{w.translation}</div>}
                      </div>
                    </div>
                    {!combineMode && (
                      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", flexShrink: 0 }}>
                        {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                          <div key={s} style={{ position: "relative" }}>
                            <button onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }} style={{ background: w.status === s ? color : "transparent", border: "1px solid " + (w.status === s ? color : "rgba(255,255,255,0.2)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>{label}</button>
                            <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                          </div>
                        ))}
                        <div style={{ position: "relative" }}>
                          <button onClick={e => { e.stopPropagation(); if (window.confirm(`Obrisati "${w.word}"?`)) deleteWord(w.id); }} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "var(--v-statusInactive)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "var(--v-text)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--v-statusInactive)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                          <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
          </div></>)}
        </div>
      )}

      {view === "list" && workspaceTab === "dictionary" && combineMode && (
        <button onClick={generateCombined} disabled={selectedIds.length < 2 || combineLoading} style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: selectedIds.length >= 2 ? "var(--v-accent)" : "var(--v-border)", border: "none", color: selectedIds.length >= 2 ? "#fff" : "var(--v-muted)", padding: "14px 36px", borderRadius: 50, cursor: selectedIds.length >= 2 ? "pointer" : "default", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, boxShadow: selectedIds.length >= 2 ? "0 4px 24px rgba(99,102,241,0.5)" : "none", zIndex: 100, whiteSpace: "nowrap", transition: "all 0.2s" }}>
          {combineLoading ? "⟳ Generišem..." : selectedIds.length < 2 ? `Označi min. 2 reči (${selectedIds.length})` : `⊕ Generiši primere (${selectedIds.length})`}
        </button>
      )}

      </div>
      <style>{`
.v6-page{max-width:1180px;margin:0 auto;padding:27px 20px 65px;font-family:Arial,sans-serif;color:var(--v-text)}
.v6-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap;margin-bottom:22px}.v6-heading h2{font-family:Georgia,serif;font-size:30px;margin:7px 0 8px}.v6-heading p{margin:0;color:var(--v-muted);font-size:14px}.v6-eyebrow{font-size:11px;font-weight:800;letter-spacing:2px;color:var(--v-accentSoft)}.v6-chip{padding:10px 15px;background:var(--v-panel);border:1px solid var(--v-border);border-radius:20px;font-size:12px;color:var(--v-muted)}
.v6-modes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:11px;margin-bottom:24px}.v6-mode{min-height:81px;border:1px solid var(--v-border);border-radius:12px;background:var(--v-panel);color:var(--v-text);padding:13px 11px;text-align:left;cursor:pointer}.v6-mode.selected{border-color:var(--v-accent);background:var(--v-selectedBg);box-shadow:0 0 0 1px var(--v-accent)}.v6-mode strong{display:block;font-size:13px;margin-bottom:7px}.v6-mode small{display:block;color:var(--v-muted);font-size:11px;line-height:1.35}
.v6-card{background:var(--v-panel);border:1px solid var(--v-border);border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.05);padding:29px;min-height:355px;max-width:830px;margin:0 auto}.v6-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--v-muted);font-size:12px;font-weight:700}.v6-track{height:7px;background:var(--v-elevated);border-radius:9px;overflow:hidden;margin-top:15px}.v6-track>div{height:100%;background:var(--v-accent);border-radius:9px;transition:width .2s}.v6-prompt{text-align:center;padding:30px 10px 25px}.v6-prompt h3{font-size:37px;font-style:italic;font-family:Georgia,serif;font-weight:500;margin:0 0 13px;overflow-wrap:anywhere}.v6-context{font-size:25px;font-family:Georgia,serif;line-height:1.5;margin-bottom:12px}.v6-prompt small{display:block;font-size:13px;color:var(--v-muted)}.v6-audio{border:0;background:none;color:var(--v-accentSoft);cursor:pointer;font-size:13px}.v6-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:670px;margin:0 auto 24px}.v6-option{background:var(--v-card);color:var(--v-text);border:1px solid var(--v-border);border-radius:10px;padding:16px;min-height:55px;cursor:pointer;font-size:16px;text-align:left}.v6-option.correct{background:var(--v-knownBg);border-color:#22a36a}.v6-option.wrong{background:var(--v-dangerBg);border-color:#de4e60}.v6-form{display:flex;flex-direction:column;gap:10px;max-width:610px;margin:0 auto 20px}.v6-form label{font-size:12px;font-weight:700;color:var(--v-muted)}.v6-form input{background:var(--v-input);color:var(--v-text);border:1px solid var(--v-border);border-radius:10px;padding:15px 17px;font-size:18px;width:100%;box-sizing:border-box}.v6-main-btn{background:var(--v-accent);color:var(--v-accentText);border:1px solid var(--v-accent);border-radius:10px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer}.v6-main-btn:disabled{opacity:.45;cursor:default}.v6-alt-btn{border:1px solid var(--v-border);background:var(--v-card);color:var(--v-text);border-radius:10px;padding:12px 18px;cursor:pointer}.v6-feedback{display:flex;flex-direction:column;gap:5px;border-radius:10px;padding:16px;max-width:640px;margin:14px auto}.v6-feedback.yes{background:var(--v-knownBg);border:1px solid #22a36a}.v6-feedback.no{background:var(--v-dangerBg);border:1px solid #de4e60}.v6-feedback small{color:var(--v-muted)}.v6-card-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid var(--v-border);padding-top:18px;margin-top:22px;font-size:13px;color:var(--v-muted)}.v6-card-footer b{color:var(--v-text)}.v6-results,.v6-empty{text-align:center}.v6-results h3{font-family:Georgia,serif;font-size:27px}.v6-icon{font-size:50px}.v6-score{font-size:45px;color:var(--v-accentSoft);font-weight:700}.v6-mistakes{text-align:left;max-width:600px;margin:20px auto}.v6-mistakes>div{display:flex;flex-direction:column;gap:4px;padding:11px;border-bottom:1px solid var(--v-border);font-size:13px}.v6-mistakes span{color:var(--v-muted)}.v6-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.v6-note{max-width:830px;margin:18px auto 0;color:var(--v-muted);font-size:12px;line-height:1.5}
@media(max-width:1000px){.v6-modes{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:620px){.v6-page{padding:16px 12px 40px}.v6-modes{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.v6-mode{padding:10px}.v6-card{padding:16px}.v6-prompt h3{font-size:30px}.v6-context{font-size:19px}.v6-options{grid-template-columns:1fr}.v6-card-footer{flex-wrap:wrap}.v6-heading h2{font-size:24px}}

.vocab-practice-page { font-family: Georgia, serif; }
.v51-modes {display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:30px}
.v51-mode-buttons {display:flex;flex-wrap:wrap;gap:10px}
.v51-mode {border:1px solid var(--v-border);background:var(--v-panel);color:var(--v-text);border-radius:24px;padding:14px 22px;font-size:16px;font-weight:650;cursor:pointer}
.v51-mode.active,.v51-primary {background:var(--v-accent);color:var(--v-accentText);border-color:var(--v-accent)}
.v51-goal-controls {display:flex;gap:9px;align-items:center;font-size:14px;font-family:Arial,sans-serif;color:var(--v-text)}
.v51-goal-controls label {border:1px solid var(--v-border);border-right:0;background:var(--v-panel);padding:12px 2px 12px 15px;border-radius:12px 0 0 12px;white-space:nowrap}
.v51-goal-controls select {border:1px solid var(--v-border);border-left:0;border-radius:0 12px 12px 0;background:var(--v-panel);color:var(--v-text);padding:12px 9px;margin-left:-9px;font-weight:700}
.v51-goal-controls strong{white-space:nowrap}
.v51-top-progress,.v51-progress-bar{height:14px;background:var(--v-elevated);border-radius:20px;overflow:hidden}
.v51-top-progress{width:140px}
.v51-top-progress span,.v51-progress-bar span{display:block;height:100%;border-radius:20px;background:linear-gradient(90deg,#10a763,#28c87a);transition:width .3s}
.v51-practice-grid{display:grid;grid-template-columns:minmax(245px,.95fr) minmax(380px,1.72fr) minmax(270px,.99fr);gap:20px;align-items:start}
.v51-pane,.v51-flashcard,.v51-explanation{background:var(--v-panel);border:1px solid var(--v-border);border-radius:20px;box-shadow:0 9px 26px rgba(31,78,137,.055)}
.v51-pane{padding:22px}
.v51-pane-title{display:flex;align-items:center;gap:14px;margin-bottom:23px}
.v51-pane-title b{display:block;font-size:22px;line-height:1.14;color:var(--v-text)}
.v51-pane-title small{display:block;font-size:13px;color:var(--v-muted);margin-top:5px}
.v51-icon{width:48px;height:48px;flex-shrink:0;display:grid;place-items:center;border-radius:14px;background:var(--v-elevated);color:var(--v-accent);font-size:26px}
.v51-stat{display:flex;align-items:center;gap:14px;border:1px solid var(--v-border);border-radius:14px;background:var(--v-card);padding:13px 14px;margin-bottom:10px}
.v51-stat small,.v51-stat strong{display:block}
.v51-stat small{font-size:15px;color:var(--v-muted);margin-bottom:5px}
.v51-stat strong{font-size:30px;line-height:1.1;color:var(--v-text)}
.v51-stat-icon{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-size:27px;flex-shrink:0}
.v51-stat-icon.blue {color:#197ce8;background:#e9f3ff}.v51-stat-icon.green{color:#13a46a;background:#e5f7ec}.v51-stat-icon.purple{color:#7055df;background:#f0edff}
.v51-progress-section{margin:28px 0 25px}
.v51-progress-head{display:flex;justify-content:space-between;align-items:center;font-size:17px;margin-bottom:14px}
.v51-progress-bar{height:17px}
.v51-next-date{display:flex;gap:13px;align-items:center;background:var(--v-elevated);border-radius:14px;padding:14px 12px}
.v51-next-date b,.v51-next-date small{display:block}.v51-next-date b{font-size:15px}.v51-next-date small{font-size:13px;color:var(--v-muted);margin-top:5px}
.v51-middle{min-width:0}
.v51-flashcard{border:2px solid var(--v-accent);padding:22px 25px 24px;min-height:410px;display:flex;flex-direction:column}
.v51-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.v51-counter,.v51-card-mode{background:var(--v-elevated);color:var(--v-accentSoft);border-radius:30px;padding:9px 17px;font:700 14px Arial,sans-serif}
.v51-card-mode{font-size:13px}.v51-star{font-size:29px;width:42px;height:42px;border:1px solid var(--v-border);border-radius:50%;text-align:center;line-height:38px;color:var(--v-muted)}
.v51-word{text-align:center;margin:22px 0 16px}.v51-word-line{display:flex;align-items:center;justify-content:center;gap:18px}.v51-word h2{font-size:clamp(35px,4vw,58px);font-weight:700;font-style:italic;line-height:1.16;margin:0;overflow-wrap:anywhere}.v51-ipa{font:16px monospace;color:var(--v-muted);margin-top:10px}
.v51-sound{border:none;border-radius:50%;background:var(--v-elevated);color:var(--v-accent);font-size:19px;width:53px;height:53px;cursor:pointer;flex-shrink:0}
.v51-question{text-align:center;margin:15px 0 25px}.v51-question p{font-size:18px;color:var(--v-muted);margin:8px 0 24px}
.v51-reveal{border:0;border-radius:26px;padding:14px 35px;background:linear-gradient(110deg,#ffad19,#de7900);color:#fff;font-size:17px;font-weight:700;box-shadow:0 6px 17px rgba(212,126,14,.2);cursor:pointer}
.v51-revealed{display:flex;flex-direction:column;gap:14px;margin:8px 0 16px}
.v51-answer{background:linear-gradient(100deg,#dff7e9,#cdf4df);color:#075b39;font-size:28px;font-weight:bold;text-align:center;border-radius:13px;padding:16px 12px;overflow-wrap:anywhere}
.v51-example{display:flex;gap:17px;padding:15px 6px;color:var(--v-text)}.v51-example>span{color:var(--v-accent);font-size:34px;font-weight:bold;line-height:1}.v51-example strong{color:var(--v-accent);font:700 14px Arial,sans-serif}.v51-example-en{font-size:17px;font-weight:700;font-style:italic;margin:5px 0}.v51-example small{color:var(--v-muted);font-size:14px}
.v51-rating-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.v51-rating{display:flex;flex-direction:column;gap:6px;align-items:center;border-radius:13px;padding:13px 4px;cursor:pointer;min-width:0}.v51-rating b{font-size:15px;white-space:nowrap}.v51-rating small{font-size:12px;color:var(--v-text)}.v51-rating.bad{background:#fff0f3;color:#d71937;border:1px solid #fb5672}.v51-rating.hard{background:#fff7e6;color:#d77700;border:1px solid #ffad19}.v51-rating.good{background:#e6f8ef;color:#087c48;border:1px solid #25b66b}
.v51-card-bottom{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--v-border);margin-top:auto;padding-top:20px}.v51-card-bottom button,.v51-below-card button,.v51-outline{color:var(--v-accentSoft);background:var(--v-card);border:1px solid var(--v-border);border-radius:12px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:700}
.v51-below-card{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px}.v51-below-card button{background:var(--v-panel);border-radius:25px}.v51-below-card button:disabled{opacity:.4;cursor:not-allowed}.v51-dots{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}.v51-dots i{display:block;background:var(--v-border);border-radius:100%;width:9px;height:9px}.v51-dots i.on{background:#13b36c}
.v51-queue-row{display:flex;align-items:center;gap:12px;width:100%;background:var(--v-card);border:1px solid var(--v-border);border-radius:13px;padding:15px 12px;margin-top:6px;margin-bottom:8px;cursor:pointer;text-align:left;color:var(--v-text)}.v51-queue-num{display:grid;place-items:center;background:var(--v-elevated);height:37px;width:37px;flex-shrink:0;border-radius:50%;font:700 15px Arial,sans-serif}.v51-queue-label{flex:1;min-width:0}.v51-queue-label b{display:block;font-size:21px;font-style:italic;overflow-wrap:anywhere}.v51-queue-label small{font:13px monospace;color:var(--v-muted);display:block;margin-top:4px}.v51-status{font:700 12px Arial,sans-serif;border-radius:22px;padding:8px 10px;white-space:nowrap}.v51-status.learning{background:#fae4e9;color:#be173e}.v51-status.known{background:#e1f0ff;color:#1771be}.v51-status.new{background:#eee6ff;color:#6748ca}.v51-empty{font-size:13px;color:var(--v-muted)}
.v51-explanation{margin-top:26px;padding:14px 20px;display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center}.v51-explanation>div:first-child{display:flex;gap:14px;align-items:center}.v51-explanation b,.v51-explanation small{display:block}.v51-explanation b{font-size:15px}.v51-explanation small{font-size:12px;color:var(--v-muted);margin-top:5px}.v51-explanation>div:last-child{border-left:1px solid var(--v-border);padding-left:22px}.v51-explanation>div:last-child>span{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.v51-explanation em{font:12px Arial,sans-serif;background:var(--v-elevated);color:var(--v-muted);border-radius:20px;padding:7px 10px;font-style:normal}
.v51-finished{text-align:center;align-items:center;justify-content:center;gap:12px}.v51-finished-emoji{font-size:45px}.v51-finished h2{margin:0}.v51-finished p{color:var(--v-muted);max-width:450px;line-height:1.6}.v51-primary{border:0;border-radius:10px;padding:12px 25px;cursor:pointer;font-weight:700}
@media(max-width:1150px){.v51-practice-grid{grid-template-columns:minmax(215px,.9fr) minmax(330px,1.5fr)}.v51-right{grid-column:1/-1}.v51-queue-row{display:inline-flex;width:calc(50% - 8px);vertical-align:top;margin-right:8px}.v51-goal-controls{margin-left:0}}
@media(max-width:780px){.v51-practice-grid{grid-template-columns:1fr}.v51-right{grid-column:auto}.v51-mode{padding:12px 14px;font-size:14px}.v51-queue-row{display:flex;width:100%;margin-right:0}.v51-explanation{grid-template-columns:1fr}.v51-explanation>div:last-child{border:0;border-top:1px solid var(--v-border);padding:15px 0 0}.v51-left{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.v51-left .v51-pane-title,.v51-left .v51-progress-section,.v51-left .v51-next-date{grid-column:1/-1}.v51-stat{padding:8px;gap:6px}.v51-stat-icon{height:32px;width:32px;font-size:17px}.v51-stat small{font-size:11px}.v51-stat strong{font-size:22px}}
@media(max-width:520px){.v51-left{grid-template-columns:1fr}.v51-modes{gap:14px}.v51-goal-controls{flex-wrap:wrap}.v51-top-progress{width:85px}.v51-flashcard{padding:17px 13px}.v51-card-mode{display:none}.v51-rating-grid{gap:5px}.v51-rating b{font-size:12px}.v51-rating small{font-size:10px}.v51-card-bottom button{padding:9px 8px;font-size:11px}.v51-dots{display:none}.v51-pane{padding:16px}}
`}</style>
      <style>{`
.v8-page{max-width:1080px;margin:0 auto;padding:28px 24px 50px;color:var(--v-text)}
.v8-heading{display:flex;justify-content:space-between;align-items:start;gap:20px;flex-wrap:wrap;margin-bottom:23px}
.v8-heading h2{font-size:29px;margin:5px 0 9px}.v8-heading p{margin:0;color:var(--v-muted);font-size:14px;line-height:1.6;max-width:690px}
.v8-eyebrow{font:700 11px monospace;letter-spacing:2px;color:var(--v-accentSoft)}.v8-chip{background:var(--v-elevated);border:1px solid var(--v-border);border-radius:40px;padding:10px 16px;color:var(--v-muted);font-size:13px}
.v8-modes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.v8-mode{border:1px solid var(--v-border);background:var(--v-panel);color:var(--v-text);border-radius:14px;padding:16px 13px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:7px;min-height:85px}
.v8-mode.selected{border:2px solid var(--v-accent);background:var(--v-selectedBg)}.v8-mode strong{font-size:15px}.v8-mode small{font-size:12px;color:var(--v-muted)}
.v8-controls{display:flex;flex-wrap:wrap;align-items:end;gap:13px;padding:16px;background:var(--v-panel);border:1px solid var(--v-border);border-radius:14px;margin-bottom:16px}
.v8-controls label{display:flex;flex-direction:column;gap:7px;font-size:12px;color:var(--v-muted)}
.v8-controls select,.v8-answer-row input{background:var(--v-input);color:var(--v-text);border:1px solid var(--v-border);border-radius:9px;padding:11px 13px;font-size:14px;min-height:42px;box-sizing:border-box}
.v8-primary{background:var(--v-accent);color:var(--v-accentText);border:none;border-radius:10px;padding:12px 18px;font-size:13px;font-weight:700;cursor:pointer;min-height:42px}.v8-primary:disabled{opacity:.45;cursor:not-allowed}
.v8-secondary{border:1px solid var(--v-accent);color:var(--v-accentSoft);background:var(--v-elevated);border-radius:10px;padding:11px 16px;cursor:pointer;font-size:13px;font-weight:700}
.v8-focus{color:var(--v-muted);font-size:13px;line-height:1.5;margin:0 0 16px}.v8-card{padding:28px;border:1px solid var(--v-border);border-radius:18px;background:var(--v-panel);min-height:235px;box-shadow:0 9px 30px rgba(15,40,80,.05)}.v8-card h3{font-size:26px;margin:12px 0 18px}.v8-empty{color:var(--v-muted);text-align:center;padding:60px 12px;line-height:1.6}.v8-story{font-size:17px;line-height:1.9;margin:0 0 18px}.v8-translation,.v8-feedback{background:var(--v-elevated);border-radius:12px;padding:18px;margin-top:16px;white-space:pre-wrap;line-height:1.7;font-size:15px}.v8-feedback strong{color:var(--v-accentSoft)}.v8-feedback p{margin:7px 0 14px}.v8-tip{color:var(--v-muted);font-size:12px;line-height:1.7;margin:12px 0}.v8-question{font-size:23px!important;line-height:1.7}.v8-answer-row{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap;margin-top:18px}.v8-answer-row input{flex:1;min-width:200px}.v8-listen{background:var(--v-accent);color:var(--v-accentText);border:0;border-radius:28px;padding:15px 23px;cursor:pointer;font-size:16px}.v8-error{padding:12px 14px;border:1px solid var(--v-dangerBorder);background:var(--v-dangerBg);color:#d83f59;border-radius:11px;margin-bottom:14px}.v8-chat-log{max-height:460px;overflow:auto;display:flex;flex-direction:column;gap:12px;margin:12px 0}.v8-chat-bubble{border:1px solid var(--v-border);background:var(--v-card);padding:13px 17px;border-radius:13px;max-width:86%;line-height:1.65}.v8-chat-bubble.user{align-self:flex-end;background:var(--v-selectedBg)}.v8-chat-bubble b{font-size:12px;color:var(--v-accentSoft)}.v8-chat-bubble p{margin:7px 0 0;white-space:pre-wrap}
@media(max-width:780px){.v8-modes{grid-template-columns:repeat(2,minmax(0,1fr))}.v8-page{padding:18px 12px 35px}.v8-card{padding:18px}.v8-heading h2{font-size:23px}}
@media(max-width:420px){.v8-modes{grid-template-columns:1fr 1fr}.v8-mode{padding:11px}.v8-mode strong{font-size:12px}.v8-controls select{max-width:100%}}
`}</style>
      <style>{`
/* V9 Visual Refresh — visual-only layer. Keeps Supabase/SRS/AI logic unchanged. */
.v9-app{--v9-shadow:0 8px 25px rgba(12,48,92,.06);font-family:Inter,'Segoe UI',Arial,sans-serif!important}
.v9-app *{box-sizing:border-box}
.v9-app h1,.v9-app h2,.v9-app h3,.v9-app h4{font-family:Inter,'Segoe UI',Arial,sans-serif;letter-spacing:-.025em}
.v9-app button,.v9-app select,.v9-app input{font-family:Inter,'Segoe UI',Arial,sans-serif!important}
.v93-settings-page{max-width:1050px;margin:0 auto;padding:28px 16px;display:grid;gap:22px}
.v93-settings-header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.v93-settings-card{background:var(--v-panel);border:1px solid var(--v-border);border-radius:18px;padding:25px;box-shadow:var(--v9-shadow)}
.v93-settings-create{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0 22px}
.v93-settings-create input{flex:1 1 220px;min-width:0;background:var(--v-input);color:var(--v-text);border:1px solid var(--v-border);border-radius:10px;padding:12px}
.v93-settings-create button{background:var(--v-accent);color:var(--v-accentText);border:0;border-radius:10px;padding:12px 20px;font-weight:750;cursor:pointer}
.v93-settings-create button:disabled{opacity:.5;cursor:not-allowed}
.v93-settings-tags{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.v93-settings-tag{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--v-border);border-radius:11px;background:var(--v-card);padding:13px}
.v93-settings-tag strong{display:block;font-size:14px;overflow-wrap:anywhere}.v93-settings-tag small{display:block;color:var(--v-muted);margin-top:4px}
.v93-settings-tag button{border:1px solid var(--v-border);border-radius:8px;color:var(--v-text);background:var(--v-elevated);padding:7px 10px;cursor:pointer}
.v93-settings-tag button:disabled{opacity:.4;cursor:not-allowed}
.v93-tag-dropdown{max-width:440px;position:relative}.v93-tag-dropdown summary{list-style:none;cursor:pointer;border:1px solid var(--v-border);background:var(--v-input);color:var(--v-text);border-radius:10px;padding:12px 15px;display:flex;justify-content:space-between;align-items:center}
.v93-tag-dropdown summary::-webkit-details-marker{display:none}.v93-tag-dropdown[open] summary{border-color:var(--v-accent);border-radius:10px 10px 0 0}
.v93-tag-dropdown-content{max-height:260px;overflow-y:auto;border:1px solid var(--v-accent);border-top:0;border-radius:0 0 10px 10px;background:var(--v-panel);padding:5px}
.v93-tag-option{display:flex;align-items:center;gap:10px;padding:9px 10px;cursor:pointer;border-radius:7px;color:var(--v-text);font-size:13px}.v93-tag-option:hover{background:var(--v-elevated)}
.v93-tag-option input{width:17px;height:17px;accent-color:var(--v-accent);cursor:pointer}
.v93-tag-chip{padding:5px 10px;font-size:12px;background:var(--v-elevated);border:1px solid var(--v-border);border-radius:20px;color:var(--v-text)}
.v9-sidebar{position:fixed;inset:0 auto 0 0;width:232px;z-index:200;background:var(--v-panel)!important;padding:22px 13px!important;border-right:1px solid var(--v-border)!important;color:var(--v-text)!important;box-shadow:3px 0 22px rgba(0,0,0,.07);overflow:visible}
.v9-sidebar-inner{max-width:none!important;height:100%;display:flex;flex-direction:column}
.v9-sidebar-head{display:flex!important;flex-direction:column!important;gap:16px;margin-bottom:28px!important;align-items:stretch!important}
.v9-sidebar-head>div:first-child{padding:8px 10px}
.v9-sidebar-head>div:first-child>div:first-child{color:var(--v-accent)!important;font-size:10px!important;letter-spacing:2px!important}
.v9-sidebar-head h1{color:var(--v-text)!important;font-family:Inter,'Segoe UI',Arial,sans-serif!important;font-size:21px!important;font-weight:750!important}
.v9-sidebar-head>div:first-child>div:last-child{color:var(--v-subtle)!important}
.v9-sidebar-head>div:nth-child(2){align-items:stretch!important;gap:6px!important;padding:0 9px}
.v9-sidebar-head>div:nth-child(2)>div:first-child{font-size:10px!important;color:var(--v-muted)!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v9-sidebar-head button[aria-label="Promeni temu"]{width:100%;text-align:left;background:var(--v-elevated)!important;border:1px solid var(--v-border)!important;color:var(--v-text)!important;padding:11px!important}
.v9-sidebar-head button:not([aria-label]){color:var(--v-muted)!important;border-color:var(--v-border)!important}
.v9-navigation{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:7px!important;margin-bottom:0!important}
.v9-navigation>button{width:100%;text-align:left;padding:13px 13px!important;border:0!important;background:transparent!important;color:var(--v-text)!important;border-radius:11px!important;white-space:normal!important;font-size:13px!important;min-height:43px}
.v9-navigation>button:hover{background:var(--v-elevated)!important}
.v9-navigation>button[style*="background: var(--v-accent)"]{background:var(--v-selectedBg)!important;color:var(--v-text)!important;border:1px solid var(--v-accent)!important}
.v9-navigation>button:last-child{margin-left:0!important;margin-top:18px!important;background:var(--v-accent)!important;color:var(--v-accentText)!important;text-align:center}
.v9-status-shortcuts{display:none!important}
.v9-main{margin-left:232px;min-height:100vh;background:var(--v-bg);padding:16px 20px 48px}
.v9-main>div,.v9-main>main{max-width:1340px!important}
.v9-main button{transition:transform .15s,filter .15s,box-shadow .15s}
.v9-main button:hover{filter:brightness(1.035);transform:translateY(-1px)}
.v9-main .vocab-stat-grid>div,.v9-main .vocab-hero-grid>div,.v9-main .v51-pane,.v9-main .v51-flashcard,.v9-main .v8-card,.v9-main .v6-card,.v9-main .v6-mode,.v9-main .v8-mode{box-shadow:var(--v9-shadow)!important;border:1px solid var(--v-border)!important;border-radius:17px!important}
.v9-main .vocab-stat-grid>div{padding:21px!important;min-height:125px;background:var(--v-panel)!important}
.v9-main .vocab-stat-grid>div>div:nth-child(2){font-size:36px!important}
.v9-main .vocab-stat-grid>div>div:first-child{font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:13px!important}
.v9-dashboard{background:transparent;padding:6px 0}
.v9-dashboard>div:first-child h2{font-size:30px!important;font-weight:780!important}
.v9-dashboard .vocab-hero-grid>div{min-height:215px;position:relative}
.v9-dashboard .vocab-hero-grid h3{font-size:20px!important}
.v9-dashboard-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0 0}
.v9-dashboard-actions button{padding:14px 10px;background:var(--v-panel);color:var(--v-text);border:1px solid var(--v-border);border-radius:12px;cursor:pointer;font-weight:700}
.v9-dashboard-actions button:first-child{background:var(--v-accent);color:var(--v-accentText);border-color:var(--v-accent)}
.v9-recent>div:last-child>button{box-shadow:var(--v9-shadow);min-height:88px;border-radius:13px!important}
.v9-dictionary h2{font-size:28px!important}
.v9-dictionary .vocab-toolbar{box-shadow:var(--v9-shadow)!important;border-radius:15px!important;padding:13px!important}
.v9-dictionary .vocab-toolbar input{min-width:230px}
.v9-main .v51-practice-grid{grid-template-columns:minmax(185px,.8fr) minmax(290px,1.65fr) minmax(220px,.9fr);gap:17px}
.v9-main .v51-flashcard{background:var(--v-panel);border-color:var(--v-border)!important}
.v9-main .v51-word h2{font-size:44px!important}
.v9-main .v51-reveal{border-radius:12px!important}
.v9-main .v6-page h2,.v9-main .v8-page h2{font-size:30px;font-weight:780}
.v9-main .v6-mode,.v9-main .v8-mode{padding:20px!important;min-height:110px!important}
.v9-main .v6-mode strong,.v9-main .v8-mode strong{font-size:15px}
.v9-main .v8-mode{align-items:center;text-align:center;justify-content:center;min-height:140px!important}
.v9-main .v8-mode:before{content:'✦';display:block;font-size:25px;color:var(--v-accent);margin-bottom:6px}
.v9-main .v8-mode:nth-child(2):before{content:'✎'}
.v9-main .v8-mode:nth-child(3):before{content:'♫'}
.v9-main .v8-mode:nth-child(4):before{content:'☏'}
.v9-main .vocab-practice-page{max-width:1450px!important}
.v9-app :is(.v9-main section,.v9-main article){scroll-margin-top:20px}
@media(max-width:1150px){.v9-main .v51-practice-grid{grid-template-columns:1fr!important}.v9-main .v51-right{grid-column:auto}}
@media(max-width:960px){.v9-sidebar{width:190px}.v9-main{margin-left:190px;padding:13px}.v9-navigation>button{font-size:12px!important;padding:12px 8px!important}.v9-dashboard-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){
 .v9-sidebar{position:relative;inset:auto;width:100%;height:auto;overflow:visible;padding:12px 12px 10px!important;background:var(--v-header)!important;color:var(--v-text)!important;box-shadow:none;border-bottom:1px solid var(--v-border)!important;z-index:210}
 .v9-sidebar-inner{display:block}
 .v9-sidebar-head{flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:6px!important;margin:0!important}
 .v9-sidebar-head>div:first-child{padding:0}
 .v9-sidebar-head>div:first-child>div:first-child{font-size:8px!important;color:var(--v-accent)!important}
 .v9-sidebar-head h1{font-size:18px!important;color:var(--v-text)!important}
 .v9-sidebar-head>div:nth-child(2){padding:0;max-width:140px;align-items:flex-end!important}
 .v9-sidebar-head>div:nth-child(2)>div:first-child{display:none}
 .v9-sidebar-head button[aria-label="Promeni temu"]{padding:8px!important;font-size:10px!important;background:var(--v-elevated)!important;color:var(--v-text)!important;border-color:var(--v-border)!important}
 .v9-sidebar-head button:not([aria-label]){display:none}
 .v9-navigation{position:fixed;bottom:0;left:0;right:0;display:flex!important;flex-direction:row!important;overflow-x:auto;background:var(--v-panel);border-top:1px solid var(--v-border);padding:8px 7px max(8px,env(safe-area-inset-bottom));gap:4px!important;z-index:300;box-shadow:0 -5px 20px rgba(0,30,70,.08);scrollbar-width:none}
 .v9-navigation>button{flex:1 0 auto;width:auto;min-width:52px;white-space:nowrap!important;font-size:10px!important;padding:11px 6px!important;min-height:38px;color:var(--v-text)!important;background:var(--v-elevated)!important}
 .v9-navigation>button:last-child{margin:0!important;display:none}
 .v9-navigation>button[style*="background: var(--v-accent)"]{background:var(--v-accent)!important;color:var(--v-accentText)!important}
 .v9-main{margin-left:0;padding:5px 8px 95px}
 .v9-main .vocab-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
 .v9-dashboard-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
 .v9-main .v51-practice-grid{grid-template-columns:1fr!important}
 .v9-main .v51-word h2{font-size:33px!important}
 .v9-dictionary .vocab-toolbar input{min-width:0}
}

.v9-dictionary-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:13px 0}
.v9-dictionary-filters button{border:1px solid var(--v-border);border-radius:20px;background:var(--v-panel);color:var(--v-text);padding:9px 16px;cursor:pointer;font-weight:700;font-size:12px}
.v9-dictionary-filters button.active{background:var(--v-accent);border-color:var(--v-accent);color:var(--v-accentText)}
.v9-dictionary-filters button span{opacity:.75;font-size:11px;margin-left:5px}
.v9-dictionary-filters .v9-new-word{margin-left:auto;background:var(--v-accent);border-color:var(--v-accent);color:var(--v-accentText)}
.v9-overview-insights{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-top:14px}
.v9-overview-insights>div{background:var(--v-panel);border:1px solid var(--v-border);border-radius:17px;padding:20px;box-shadow:var(--v9-shadow)}
.v9-overview-title{font-size:15px;font-weight:800;color:var(--v-text);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.v9-overview-title span{font-size:11px;font-weight:500;color:var(--v-muted)}
.v9-mini-bars{height:135px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:9px;align-items:end;margin-top:16px}
.v9-mini-bar-column{height:100%;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:8px}
.v9-mini-bar-track{height:100%;width:100%;max-width:45px;display:flex;align-items:flex-end;border-bottom:1px solid var(--v-border)}
.v9-mini-bar-track span{display:block;width:100%;min-height:3px;background:linear-gradient(180deg,#62b5ff,var(--v-accent));border-radius:5px 5px 0 0}
.v9-mini-bar-column small{font-size:10px;color:var(--v-muted)}
.v9-overview-success{display:flex;align-items:center;flex-direction:column;gap:12px;justify-content:space-between}
.v9-overview-success .v9-overview-title{align-self:flex-start}
.v9-donut{width:112px;height:112px;flex-shrink:0;border-radius:50%;display:grid;place-items:center}
.v9-donut>div{background:var(--v-panel);color:var(--v-text);width:80px;height:80px;border-radius:50%;display:grid;place-items:center;font-size:23px;font-weight:800}
.v9-overview-success small{color:var(--v-muted);font-size:11px;text-align:center}
@media(max-width:700px){.v9-overview-insights{grid-template-columns:1fr}.v9-dictionary-filters .v9-new-word{width:100%;margin-left:0}.v9-sidebar .v9-navigation>button:last-child{display:block;position:fixed;right:14px;bottom:75px;width:auto;z-index:310;padding:12px 16px!important;box-shadow:0 5px 22px rgba(0,35,75,.18)}.v9-dashboard-actions button{font-size:12px}}
@media(prefers-reduced-motion:reduce){.v9-app *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`}</style>
      <style>{`* { outline: none; } input, textarea { transition: border-color 0.2s; } input:focus, textarea:focus { border-color: var(--v-accent) !important; } input::placeholder, textarea::placeholder { color: var(--v-subtle); } select { color-scheme: inherit; } button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--v-accent) !important; outline-offset: 2px; } button { transition: filter .16s ease, background .16s ease; } button:hover { filter: brightness(1.04); } @media(max-width: 1050px) { .vocab-practice-grid { grid-template-columns: 1fr !important; } .vocab-practice-grid > aside:first-child { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; } .vocab-practice-grid > aside:first-child > .vocab-practice-stat { margin-bottom: 0 !important; } .vocab-practice-grid > aside:first-child > div:last-child { grid-column: 1 / -1; } } @media(max-width: 720px) { .vocab-practice-grid > aside:first-child { grid-template-columns: 1fr; } .vocab-practice-footer { justify-content: center !important; } .vocab-stat-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; } .vocab-hero-grid { grid-template-columns: 1fr !important; } .vocab-toolbar > input { flex-basis: 100% !important; } }`}</style>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";








const SUPABASE_URL = "https://evajlksybjhnqvrykimf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2YWpsa3N5YmpobnF2cnlraW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NzY4NjgsImV4cCI6MjA5NjI1Mjg2OH0.WAdG0kvqXNPtgivfZwPxFDOUnmnEk95rYokK0gSRXa4";

const db = {
  async getAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?order=added_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    });
    return res.json();
  },
  async insert(w) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ word: w.word, word_sr: w.wordSr, translation: w.translation, ipa: w.ipa, part_of_speech: w.partOfSpeech, synonyms: w.synonyms, sentences: w.sentences, notes: w.notes, status: "new", review_count: 0, image_url: w.imageUrl || null })
    });
    const data = await res.json();
    return data[0];
  },
  async updateStatus(id, status, reviewCount, learnedAt) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_count: reviewCount + 1, learned_at: learnedAt || null })
    });
  },
  async updateSentences(id, sentences) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentences })
    });
  },
  async updateTranslation(id, wordSr) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ word_sr: wordSr, translation: wordSr })
    });
  },
  async updateImageUrl(id, imageUrl) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl })
    });
  },
  async delete(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
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

export default function VocabTracker() {
  const [words, setWords] = useState([]);
  const [view, setView] = useState("list");
  const [wordInput, setWordInput] = useState("");
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);



  const showToast = (msg, color = "#22c55e") => { setToast({ msg, color }); setTimeout(() => setToast(null), 2500); };

  const lookupWord = async (word) => {
    if (!word.trim() || word.trim().length < 2) { setAiData(null); return; }
    const cached = words.find(w =>
      w.word.toLowerCase() === word.trim().toLowerCase() ||
      w.wordSr?.toLowerCase() === word.trim().toLowerCase()
    );
    if (cached) { setAiData({ wordEn: cached.word, wordSr: cached.wordSr, translation: cached.translation, partOfSpeech: cached.partOfSpeech, sentences: cached.sentences }); return; }
    setAiLoading(true); setAiError(null); setAiData(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `You are a dictionary for a Serbian B1 English learner. User typed: "${word.trim()}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 3 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2","syn3"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"},]}` }] })
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

  const handleWordInput = (val) => {
    setWordInput(val); setAiData(null); setAiError(null);
  };

  const addWord = async () => {
    if (!wordInput.trim() || !aiData) return;
    const duplicate = words.find(w => w.word.toLowerCase() === (aiData.wordEn || wordInput.trim()).toLowerCase());
    if (duplicate) { showToast("Reč već postoji!", "#f59e0b"); return; }
    setSaving(true);
    try {
      const row = await db.insert({ word: aiData.wordEn || wordInput.trim(), wordSr: aiData.wordSr, translation: aiData.wordSr, ipa: aiData.ipa || "", partOfSpeech: aiData.partOfSpeech, synonyms: aiData.synonyms || [], sentences: aiData.sentences, notes: notes.trim(), imageUrl: null });
      if (row) setWords(prev => [normalize(row), ...prev]);
      setWordInput(""); setAiData(null); setNotes(""); setView("list");
      showToast("Reč sačuvana u bazu ✓");
    } catch (e) { showToast("Greška pri čuvanju", "#ef4444"); }
    setSaving(false);
  };

  const updateStatus = async (id, status) => {
    const w = words.find(x => x.id === id);
    const learnedAt = status === "known" ? new Date().toISOString() : null;
    await db.updateStatus(id, status, w?.reviewCount || 0, learnedAt);
    setWords(prev => prev.map(x => x.id === id ? { ...x, status, reviewCount: (x.reviewCount || 0) + 1, learnedAt } : x));
  };

  const deleteWord = async (id) => {
    await db.delete(id);
    setWords(prev => prev.filter(x => x.id !== id)); setView("list");
    showToast("Obrisano", "#ef4444");
  };

  const filteredWords = words.filter(w => {
    const mf = filter === "all" || w.status === filter;
    const ms = w.word?.toLowerCase().includes(search.toLowerCase()) || w.translation?.toLowerCase().includes(search.toLowerCase());
    return mf && ms;
  });

  const reviewWords = words.filter(w => w.status === "learning");
  const currentReview = reviewWords[reviewIndex];
  const statusLabel = s => ({ new: "Novo", learning: "Učim", known: "Znam" }[s] || s);
  const statusDot = s => ({ new: "#3b82f6", learning: "#f59e0b", known: "#22c55e" }[s] || "#999");
  const counts = { all: words.length, new: words.filter(w => w.status === "new").length, learning: words.filter(w => w.status === "learning").length, known: words.filter(w => w.status === "known").length };
  const inp = { width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" };

  const [popup, setPopup] = useState(null); // { word, x, y }
  const [quickAdding, setQuickAdding] = useState(false);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editTranslationVal, setEditTranslationVal] = useState("");
  const [combineMode, setCombineMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [combineResult, setCombineResult] = useState(null);
  const [combineLoading, setCombineLoading] = useState(false);
  const [savingTo, setSavingTo] = useState(null);
  const [wordImage, setWordImage] = useState(null); // { url, author, authorUrl }
  const [imageLoading, setImageLoading] = useState(false); // { sentenceIndex, selectedWordIds: [] }

  const handleQuickAdd = async (word) => {
    if (!word || word.trim().length < 2) return;
    const already = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (already) { showToast("Već postoji u rečniku!", "#f59e0b"); setPopup(null); return; }
    setQuickAdding(true);
    setPopup(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `You are a dictionary for a Serbian B1 English learner. User typed: "${word.trim()}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 3 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"},]}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const ai = JSON.parse(text.replace(/```json|```/g, "").trim());
      const row = await db.insert({ word: ai.wordEn || word.trim(), wordSr: ai.wordSr, translation: ai.wordSr, ipa: ai.ipa || "", partOfSpeech: ai.partOfSpeech, synonyms: ai.synonyms || [], sentences: ai.sentences, notes: "", imageUrl: null });
      if (row) setWords(prev => [normalize(row), ...prev]);
      showToast(`"${ai.wordEn}" dodato u rečnik ✓`);
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setQuickAdding(false);
  };

  const handleTextSelection = (e) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length >= 2 && text.length <= 60) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setPopup({ word: text, x: rect.left + rect.width / 2, y: rect.top - 10 });
    } else {
      setPopup(null);
    }
  };

  const handleWordClick = (e, word) => {
    e.stopPropagation();
    const sel = window.getSelection();
    // If user selected text, let handleTextSelection handle it
    if (sel && sel.toString().trim().length > 0) return;
    const clean = word.replace(/[^a-zA-ZčćžšđČĆŽŠĐ\s'-]/g, "").trim();
    if (!clean || clean.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    setPopup({ word: clean, x: rect.left + rect.width / 2, y: rect.top - 10 });
  };

  const ClickableSentence = ({ text, highlightTarget }) => {
    const onMouseUpHandler = e => {
      const sel = window.getSelection();
      const selected = sel?.toString().trim();
      if (selected && selected.length >= 2 && selected.length <= 60) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopup({ word: selected, x: rect.left + rect.width / 2, y: rect.top - 10 });
      }
    };

    // Multi-word phrase — highlight whole phrase, keep rest clickable word-by-word
    if (highlightTarget && highlightTarget.trim().includes(" ")) {
      const escaped = highlightTarget.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escaped})`, "gi");
      const parts = text.split(regex);
      return (
        <span onMouseUp={onMouseUpHandler}>
          {parts.map((part, i) =>
            regex.test(part)
              ? <strong key={i} style={{ color: "#fff", fontWeight: 700 }}>{part}</strong>
              : <span key={i}>{part}</span>
          )}
        </span>
      );
    }

    // Single word — token-by-token, each word clickable
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
        <div style={{ background: "rgba(99,102,241,0.12)", borderLeft: "2px solid #6366f1", padding: "12px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#6366f1", letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Engleski</div>
            <textarea value={editEn} onChange={e => setEditEn(e.target.value)} rows={2} style={{ width: "100%", background: "#12121a", border: "1px solid #6366f1", color: "#f0ebe3", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#6366f1", letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Srpski</div>
            <textarea value={editSr} onChange={e => setEditSr(e.target.value)} rows={2} style={{ width: "100%", background: "#12121a", border: "1px solid #6366f1", color: "#f0ebe3", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onUpdate(i, { en: editEn, sr: editSr }); setEditing(false); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓ Sačuvaj</button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>✕ Odustani</button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid #6366f1", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: "#d0cbc4", marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 11, marginRight: 2, flexShrink: 0, marginTop: 2 }}>{i + 1}.</span>
          <span style={{ flex: 1 }}><ClickableSentence text={s.en || s} highlightTarget={word} /></span>
          <button onClick={() => speak(s.en || s)} title="Izgovori" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 2px", opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
          <button onClick={() => { setEditEn(s.en || s); setEditSr(s.sr || ""); setEditing(true); }} title="Izmeni" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, flexShrink: 0, color: "#a5b4fc" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>✎</button>
          <button onClick={() => onDelete(i)} title="Obriši primer" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, flexShrink: 0, color: "#ef4444" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>✕</button>
        </div>
        {s.sr && <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", paddingLeft: 20 }}>↳ {s.sr}</div>}
      </div>
    );
  };

  const fetchImage = async (word, cachedUrl = null, wordId = null) => {
    if (cachedUrl) {
      setWordImage({ url: cachedUrl, cached: true });
      return;
    }
    setWordImage(null); setImageLoading(true);
    try {
      const res = await fetch(`/api/unsplash?query=${encodeURIComponent(word)}`);
      const data = await res.json();
      const photo = data.results?.[0];
      if (photo) {
        const imgUrl = photo.urls.small;
        setWordImage({ url: imgUrl, author: photo.user.name, authorUrl: photo.user.links.html });
        if (wordId) {
          await db.updateImageUrl(wordId, imgUrl);
          setWords(prev => prev.map(w => w.id === wordId ? { ...w, imageUrl: imgUrl } : w));
        }
      }
    } catch (e) { setWordImage(null); }
    setImageLoading(false);
  };

  const speak = (text) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-US";
    utt.rate = 0.9;
    utt.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang === "en-US" && v.name.includes("Google")) || voices.find(v => v.lang === "en-US");
    if (enVoice) utt.voice = enVoice;
    window.speechSynthesis.speak(utt);
  };

  const generateCombined = async () => {
    const selected = words.filter(w => selectedIds.includes(w.id));
    if (selected.length < 2) return;
    setCombineLoading(true); setCombineResult(null);
    try {
      const wordList = selected.map(w => w.word).join(", ");
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: `Write 3 natural English sentences that ALL use these words together: ${wordList}\nEach sentence must contain ALL the listed words. B1-B2 level.\nReply ONLY JSON array:\n[{"en":"sentence 1","sr":"srpski prevod"},{"en":"sentence 2","sr":"srpski prevod"},{"en":"sentence 3","sr":"srpski prevod"}]` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setCombineResult({ words: selected.map(w => w.word), sentences: JSON.parse(text.replace(/```json|```/g, "").trim()) });
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setCombineLoading(false);
  };

  const exportPDF = () => {
    const filterLabel = { all: "Sve reči", new: "Novo", learning: "Učim", known: "Znam" }[filter];
    const html = `
      <style>
        body { font-family: Georgia, serif; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 28px; margin-bottom: 4px; }
        .subtitle { color: #888; font-size: 13px; margin-bottom: 32px; }
        .word-block { border: 1px solid #ddd; border-radius: 10px; padding: 20px; margin-bottom: 20px; page-break-inside: avoid; }
        .word { font-size: 22px; font-style: italic; font-weight: 700; margin-bottom: 4px; }
        .translation { font-size: 16px; color: #333; margin-bottom: 4px; }
        .pos { font-size: 11px; color: #999; font-family: monospace; margin-bottom: 12px; }
        .section-label { font-size: 10px; letter-spacing: 2px; color: #6366f1; text-transform: uppercase; margin-bottom: 6px; margin-top: 10px; }
        .synonyms { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .syn-tag { background: #f0f0ff; border: 1px solid #c7d2fe; color: #4338ca; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-style: italic; }
        .sentence { border-left: 3px solid #6366f1; padding: 8px 12px; margin-bottom: 8px; background: #f8f8ff; border-radius: 0 6px 6px 0; }
        .sentence-en { font-size: 13px; margin-bottom: 2px; }
        .sentence-sr { font-size: 12px; color: #666; font-style: italic; }
        .notes { font-size: 12px; color: #888; font-style: italic; border-top: 1px solid #eee; padding-top: 8px; margin-top: 8px; }
        .meta { font-size: 10px; color: #bbb; font-family: monospace; margin-top: 8px; }
        .status-new { border-left: 4px solid #3b82f6; }
        .status-learning { border-left: 4px solid #f59e0b; }
        .status-known { border-left: 4px solid #22c55e; }
        @media print { body { padding: 20px; } }
      </style>
      <h1>Vokabular Tracker</h1>
      <div class="subtitle">Export: ${filterLabel} · ${filteredWords.length} reči · ${new Date().toLocaleDateString("sr-RS")}</div>
      ${filteredWords.map(w => `
        <div class="word-block status-${w.status}">
          <div class="word">${w.word}</div>
          <div class="translation">${w.wordSr || w.translation || ""}</div>
          ${w.partOfSpeech ? `<div class="pos">${w.partOfSpeech}</div>` : ""}
          ${w.synonyms?.length ? `<div class="section-label">Sinonimi</div><div class="synonyms">${w.synonyms.map(s => `<span class="syn-tag">${s}</span>`).join("")}</div>` : ""}
          ${w.sentences?.length ? `<div class="section-label">Primeri</div>${w.sentences.map(s => `<div class="sentence"><div class="sentence-en">${s.en || s}</div>${s.sr ? `<div class="sentence-sr">↳ ${s.sr}</div>` : ""}</div>`).join("")}` : ""}
          ${w.notes ? `<div class="notes">📝 ${w.notes}</div>` : ""}
          <div class="meta">Dodano: ${formatDate(w.addedAt)}${w.learnedAt ? ` · Naučeno: ${formatDate(w.learnedAt)}` : ""}</div>
        </div>`).join("")}`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:9999;background:#fff;";
    document.body.appendChild(iframe);
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`);
    iframe.contentDocument.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      iframe.contentWindow.onafterprint = () => document.body.removeChild(iframe);
    }, 600);
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontFamily: "monospace", letterSpacing: 3 }}>UČITAVANJE BAZE...</div>;
  if (dbError) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 16, padding: 32, color: "#ef4444", fontFamily: "monospace", maxWidth: 400, textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div><div>{dbError}</div></div></div>;

  if (loading) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontFamily: "monospace", letterSpacing: 3 }}>UČITAVANJE BAZE...</div>;
  if (dbError) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 16, padding: 32, color: "#ef4444", fontFamily: "monospace", maxWidth: 400, textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div><div>{dbError}</div></div></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", fontFamily: "Georgia, serif", color: "#f0ebe3" }} onClick={() => setPopup(null)}>
      {/* Quick add popup */}
      {popup && (
        <div style={{ position: "fixed", left: Math.min(popup.x - 80, window.innerWidth - 180), top: popup.y - 52, zIndex: 9999, background: "#1a1a2e", border: "1px solid #6366f1", borderRadius: 10, padding: "8px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 13, color: "#a5b4fc", fontStyle: "italic", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>"{popup.word}"</span>
          <button onClick={() => handleQuickAdd(popup.word)} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>+ Dodaj</button>
          <button onClick={() => setPopup(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>
        </div>
      )}

      {/* Quick adding spinner */}
      {quickAdding && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#6366f1", color: "#fff", padding: "12px 20px", borderRadius: 10, fontFamily: "monospace", fontSize: 13, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}>
          ⟳ Dodajem u rečnik...
        </div>
      )}

      {toast && <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.color, color: "#fff", padding: "10px 20px", borderRadius: 8, fontFamily: "monospace", fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>{toast.msg}</div>}

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", borderBottom: "1px solid #2a2a3e", padding: "24px 24px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 4, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Vokabular Tracker</div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: "normal", letterSpacing: -0.5 }}>Moje Engleske Reči</h1>
            <div style={{ fontSize: 10, color: "#3a3a5e", fontFamily: "monospace", marginTop: 4 }}>● Supabase Cloud</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {["all", "new", "learning", "known"].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ background: filter === s ? "#6366f1" : "rgba(255,255,255,0.05)", border: "1px solid " + (filter === s ? "#6366f1" : "#2a2a3e"), color: filter === s ? "#fff" : "#888", padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
              {s === "all" ? "Sve" : statusLabel(s)} ({counts[s]})
            </button>
          ))}
        </div>
      </div>

      {/* ADD VIEW */}
      {view === "add" && (
        <div style={{ padding: 24, maxWidth: 620 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setView("list")} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: "normal" }}>Nova Reč</h2>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Upiši reč ili frazu (srpski ili engleski)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={wordInput} onChange={e => handleWordInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && wordInput.trim().length >= 2) lookupWord(wordInput); }}
                placeholder="npr. equity, take for granted, prinos..." autoFocus
                style={{ ...inp, flex: 1, fontSize: 18, fontStyle: "italic", padding: "14px 16px" }} />
              <button onClick={() => lookupWord(wordInput)} disabled={wordInput.trim().length < 2 || aiLoading}
                style={{ background: wordInput.trim().length >= 2 ? "#6366f1" : "#1a1a2e", border: "1px solid " + (wordInput.trim().length >= 2 ? "#6366f1" : "#2a2a3e"), color: wordInput.trim().length >= 2 ? "#fff" : "#444", padding: "0 20px", borderRadius: 8, cursor: wordInput.trim().length >= 2 ? "pointer" : "default", fontSize: 18, transition: "all 0.15s", flexShrink: 0 }}>
                {aiLoading ? "⟳" : "→"}
              </button>
            </div>
          </div>
          {aiLoading && <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 24, border: "1px solid #2a2a3e", marginBottom: 20, textAlign: "center", color: "#6366f1", fontFamily: "monospace", fontSize: 13, letterSpacing: 2 }}>TRAŽIM...</div>}
          {aiError && <div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 12, padding: 16, marginBottom: 20, color: "#ef4444", fontSize: 13 }}>{aiError}</div>}
          {aiData && !aiLoading && (
            <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 24, border: "1px solid #6366f1", marginBottom: 20 }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 22, color: "#f0ebe3" }}>
                    {wordInput.trim().toLowerCase() === aiData.wordSr?.toLowerCase() ? aiData.wordEn : aiData.wordSr}
                  </div>
                  <button onClick={() => speak(aiData.wordEn || wordInput)} title="Izgovor" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
                </div>
                {aiData.ipa && <div style={{ fontSize: 13, color: "#6366f1", fontFamily: "monospace", marginTop: 3, letterSpacing: 1 }}>{aiData.ipa}</div>}
                {aiData.partOfSpeech && <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace", marginTop: 4 }}>{aiData.partOfSpeech}</div>}
              </div>
              {aiData.synonyms?.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {aiData.synonyms.map((syn, i) => (
                      <span key={i} onClick={e => { e.stopPropagation(); const rect = e.target.getBoundingClientRect(); setPopup({ word: syn, x: rect.left + rect.width / 2, y: rect.top - 10 }); }} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic", cursor: "pointer" }}
                        onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.3)"; e.target.style.borderColor = "#6366f1"; }}
                        onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = "rgba(99,102,241,0.3)"; }}
                      >{syn}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(wordInput, (updater) => setAiData(prev => ({ ...prev, sentences: typeof updater === "function" ? updater(prev.sentences) : updater })), aiData.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid #6366f1", color: regenLoading ? "#444" : "#a5b4fc", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    {regenLoading ? "..." : "+ dodaj primer"}
                  </button>
                </div>
                {aiData.sentences?.map((s, i) => <SentenceCard key={i} s={s} i={i} word={wordInput}
                  onDelete={idx => setAiData(prev => ({ ...prev, sentences: prev.sentences.filter((_, j) => j !== idx) }))}
                  onUpdate={(idx, updated) => setAiData(prev => ({ ...prev, sentences: prev.sentences.map((x, j) => j === idx ? updated : x) }))}
                />)}
              </div>
            </div>
          )}
          {aiData && !aiLoading && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Tvoje beleške (opcionalno)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. viđeno u Bloomberg članku o ETF-ima..." rows={2} style={{ ...inp, resize: "vertical", fontFamily: "Georgia, serif" }} />
            </div>
          )}
          {aiData && !aiLoading && (
            <div style={{ height: 80 }} />
          )}
        </div>
      )}

      {/* Fixed save button — only in add view when AI data is ready */}
      {view === "add" && aiData && !aiLoading && (
        <button onClick={addWord} style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#d97706", border: "none", color: "#fff", padding: "14px 36px", borderRadius: 50, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 2, boxShadow: "0 4px 24px rgba(217,119,6,0.5)", zIndex: 100, whiteSpace: "nowrap" }}>
          {saving ? "ČUVAM..." : "SAČUVAJ U BAZU →"}
        </button>
      )}

      {/* DETAIL VIEW */}
      {view === "detail" && selected && (
        <div style={{ padding: 24, maxWidth: 620 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setWordImage(null); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
          </div>
          <div style={{ background: selected.status === "known" ? "linear-gradient(160deg, #0d2e1a, #0f3d22)" : selected.status === "learning" ? "linear-gradient(160deg, #2a0812, #3d0f1a)" : "#1a1a2e", borderRadius: 16, padding: 28, border: "1px solid " + (selected.status === "known" ? "#22c55e44" : selected.status === "learning" ? "#e11d4844" : "#2a2a3e"), transition: "background 0.4s, border-color 0.4s" }}>
            <div style={{ marginBottom: 20 }}>
              {/* Red 1: naziv + zvučnik */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 28, fontWeight: "normal", fontStyle: "italic", wordBreak: "break-word" }}>
                  {selected.word}
                </h2>
                {selected.ipa && <span style={{ fontSize: 13, color: "#6366f1", fontFamily: "monospace", letterSpacing: 1 }}>{selected.ipa}</span>}
                <button onClick={() => speak(selected.word)} title="Izgovor" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
              </div>
              {/* Red 2: statusni kružići + briši */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                  <div key={s} style={{ position: "relative" }}>
                    <button onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, status: s })); showToast("Status ažuriran"); }}
                      style={{ background: selected.status === s ? color : "transparent", border: "1px solid " + (selected.status === s ? color : "rgba(255,255,255,0.2)"), color: selected.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                      onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }}
                      onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}
                    >{label}</button>
                    <div className="tip" style={{ position: "absolute", bottom: 38, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                  </div>
                ))}
                <div style={{ position: "relative" }}>
                  <button onClick={() => deleteWord(selected.id)}
                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.3)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.3)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                  <div className="tip" style={{ position: "absolute", bottom: 38, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                </div>
                <span style={{ marginLeft: "auto", background: "rgba(99,102,241,0.15)", color: selected.status === "new" ? "#3b82f6" : selected.status === "learning" ? "#e11d48" : "#22c55e", padding: "4px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>
                  {selected.status === "new" ? "Novo" : selected.status === "learning" ? "Učim" : "Znam"}
                </span>
              </div>
            </div>
            {/* Word image */}
            {imageLoading && (
              <div style={{ height: 160, background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontFamily: "monospace", fontSize: 12 }}>učitavam sliku...</div>
            )}
            {wordImage && !imageLoading && (
              <div style={{ marginBottom: 16, borderRadius: 10, overflow: "hidden", position: "relative" }}>
                <img
                  src={wordImage.url}
                  alt={selected.word}
                  onError={e => { e.target.parentNode.style.display = "none"; }}
                  style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
                />
                <a href={`${wordImage.authorUrl}?utm_source=vokabular_tracker&utm_medium=referral`} target="_blank" rel="noreferrer"
                  style={{ position: "absolute", bottom: 6, right: 8, fontSize: 10, color: "rgba(255,255,255,0.6)", textDecoration: "none", background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: 4 }}>
                  Photo by {wordImage.author} on Unsplash
                </a>
              </div>
            )}

            {selected.translation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                {editingTranslation ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={editTranslationVal}
                      onChange={e => setEditTranslationVal(e.target.value)}
                      autoFocus
                      style={{ flex: 1, background: "#12121a", border: "1px solid #6366f1", color: "#f0ebe3", padding: "8px 12px", borderRadius: 8, fontSize: 18, fontFamily: "Georgia, serif" }}
                    />
                    <button onClick={async () => {
                      await db.updateTranslation(selected.id, editTranslationVal);
                      setWords(prev => prev.map(w => w.id === selected.id ? { ...w, wordSr: editTranslationVal, translation: editTranslationVal } : w));
                      setSelected(prev => ({ ...prev, wordSr: editTranslationVal, translation: editTranslationVal }));
                      setEditingTranslation(false);
                      showToast("Prevod ažuriran ✓");
                    }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓</button>
                    <button onClick={() => setEditingTranslation(false)} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 20, color: "#c9c0b4" }}>{selected.wordSr || selected.translation}</div>
                    <button onClick={() => { setEditTranslationVal(selected.wordSr || selected.translation); setEditingTranslation(true); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#555", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>✎ edit</button>
                  </div>
                )}
                {selected.partOfSpeech && <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", marginTop: 4 }}>{selected.partOfSpeech}</div>}
              </div>
            )}
            {selected.synonyms?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.synonyms.map((syn, i) => (
                    <span key={i} onClick={e => { e.stopPropagation(); const rect = e.target.getBoundingClientRect(); setPopup({ word: syn, x: rect.left + rect.width / 2, y: rect.top - 10 }); }} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic", cursor: "pointer" }}
                      onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.3)"; e.target.style.borderColor = "#6366f1"; }}
                      onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = "rgba(99,102,241,0.3)"; }}
                    >{syn}</span>
                  ))}
                </div>
              </div>
            )}
            {selected.sentences?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(selected.word, (updater) => {
                    const newList = typeof updater === "function" ? updater(selected.sentences) : updater;
                    setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: newList } : w));
                    setSelected(prev => ({ ...prev, sentences: newList }));
                  }, selected.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid #6366f1", color: regenLoading ? "#444" : "#a5b4fc", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    {regenLoading ? "..." : "+ dodaj primer"}
                  </button>
                </div>
                {selected.sentences.map((s, i) => <SentenceCard key={i} s={s} i={i} word={selected.word}
                  onDelete={idx => {
                    const updated = selected.sentences.filter((_, j) => j !== idx);
                    setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: updated } : w));
                    setSelected(prev => ({ ...prev, sentences: updated }));
                  }}
                  onUpdate={(idx, updatedS) => {
                    const updated = selected.sentences.map((x, j) => j === idx ? updatedS : x);
                    setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: updated } : w));
                    setSelected(prev => ({ ...prev, sentences: updated }));
                  }}
                />)}
              </div>
            )}
            {selected.notes && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 4, textTransform: "uppercase" }}>Beleške</div>
                <div style={{ fontSize: 13, color: "#888" }}>{selected.notes}</div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#444", fontFamily: "monospace" }}>
              Dodano: {formatDate(selected.addedAt)} · Ponovljeno: {selected.reviewCount}x
              {selected.learnedAt && <span style={{ color: "#22c55e" }}> · Naučeno: {formatDate(selected.learnedAt)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* REVIEW VIEW */}
      {view === "review" && (
        <div style={{ padding: 24, maxWidth: 540, margin: "0 auto" }}>
          {/* Top nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setReviewIndex(0); setRevealed(false); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
            <span style={{ fontSize: 13, color: "#888", fontFamily: "monospace" }}>{reviewIndex + 1} / {reviewWords.length}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setReviewIndex(i => (i - 1 + reviewWords.length) % reviewWords.length); setRevealed(false); }} style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#888", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 16 }}>←</button>
              <button onClick={() => { setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#888", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 16 }}>→</button>
            </div>
          </div>

          {reviewWords.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888", padding: 60, fontSize: 18 }}>Nema reči označenih kao "Učim" 📖</div>
          ) : currentReview && (
            <div style={{ background: "#1a1a2e", borderRadius: 20, padding: 36, border: "2px solid #f59e0b", textAlign: "center", display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: "#f59e0b", fontFamily: "monospace", letterSpacing: 2, marginBottom: 8 }}>KARTICA {reviewIndex + 1} OD {reviewWords.length}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <div style={{ fontSize: 38, fontStyle: "italic", fontWeight: 700 }}>{currentReview.word}</div>
                  <button onClick={() => speak(currentReview.word)} title="Izgovor" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, padding: 4, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
                </div>
                {currentReview.wordSr && <div style={{ fontSize: 16, color: "#888", marginBottom: 4 }}>{currentReview.wordSr}</div>}
                {currentReview.partOfSpeech && <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{currentReview.partOfSpeech}</div>}
              </div>

              {!revealed ? (
                <button onClick={() => setRevealed(true)} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "14px 32px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontFamily: "monospace", letterSpacing: 1 }}>POKAŽI PRIMER</button>
              ) : (
                <div>
                  {currentReview.sentences?.[0] && (
                    <div style={{ fontSize: 13, padding: "12px 16px", background: "rgba(99,102,241,0.08)", borderRadius: 8, marginBottom: 16, textAlign: "left" }}>
                      <div style={{ color: "#d0cbc4", fontStyle: "italic", lineHeight: 1.6, marginBottom: 4 }}>{highlightWord(currentReview.sentences[0].en || currentReview.sentences[0], currentReview.word)}</div>
                      {currentReview.sentences[0].sr && <div style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}>↳ {currentReview.sentences[0].sr}</div>}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => { updateStatus(currentReview.id, "new"); setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#3b82f6", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>← Vrati na Novo</button>
                    <button onClick={() => { updateStatus(currentReview.id, "known"); setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>Znam ✓</button>
                  </div>
                </div>
              )}

              {/* Dot indicators */}
              <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                {reviewWords.map((_, i) => (
                  <div key={i} onClick={() => { setReviewIndex(i); setRevealed(false); }} style={{ width: 8, height: 8, borderRadius: "50%", background: i === reviewIndex ? "#f59e0b" : "#2a2a3e", cursor: "pointer", transition: "background 0.2s" }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ padding: 24, paddingBottom: 90 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži..." style={{ flex: 1, minWidth: 120, background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontFamily: "Georgia, serif" }} />
            {filteredWords.length > 0 && (
              <button onClick={exportPDF} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid #6366f1", color: "#a5b4fc", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>↓ PDF</button>
            )}
            <button onClick={() => { setCombineMode(!combineMode); setSelectedIds([]); setCombineResult(null); }} style={{ background: combineMode ? "#6366f1" : "rgba(99,102,241,0.15)", border: "1px solid #6366f1", color: combineMode ? "#fff" : "#a5b4fc", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>
              ⊕ Kombiniraj
            </button>
            {reviewWords.length > 0 && (
              <button onClick={() => { setView("review"); setReviewIndex(0); setRevealed(false); }} style={{ background: "#f59e0b", border: "none", color: "#fff", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                🔁 Ponavljaj ({reviewWords.length})
              </button>
            )}
          </div>

          {/* Combine result panel */}
          {combineResult && (
            <div style={{ background: "#1a1a2e", border: "1px solid #6366f1", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 12, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                Kombinovani primeri —
                {combineResult.words.map(w => <span key={w} style={{ background: "rgba(99,102,241,0.2)", padding: "2px 8px", borderRadius: 10, fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>{w}</span>)}
              </div>
              {combineResult.sentences.map((s, i) => (
                <div key={i} style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid #6366f1", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, color: "#d0cbc4", lineHeight: 1.6, marginBottom: 3, display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ flex: 1 }}>{(() => {
                      let parts = [s.en];
                      combineResult.words.forEach(word => {
                        parts = parts.flatMap(part => {
                          if (typeof part !== "string") return [part];
                          const split = part.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
                          return split.map((p, j) => p.toLowerCase() === word.toLowerCase() ? <strong key={word+j} style={{ color: "#fff", fontWeight: 700 }}>{p}</strong> : p);
                        });
                      });
                      return parts;
                    })()}</span>
                    <button onClick={() => speak(s.en)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
                  </div>
                  {s.sr && <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 8 }}>↳ {s.sr}</div>}

                  {/* Save to word dropdown */}
                  {savingTo?.sentenceIndex === i ? (
                    <div style={{ background: "#12121a", border: "1px solid #2a2a3e", borderRadius: 8, padding: "10px 12px", marginTop: 6 }}>
                      <div style={{ fontSize: 10, letterSpacing: 2, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Dodaj primer za:</div>
                      {combineResult.words.map(word => {
                        const wordObj = words.find(w => w.word === word);
                        const checked = savingTo.selectedWordIds.includes(wordObj?.id);
                        return wordObj ? (
                          <div key={word} onClick={() => setSavingTo(prev => ({ ...prev, selectedWordIds: checked ? prev.selectedWordIds.filter(id => id !== wordObj.id) : [...prev.selectedWordIds, wordObj.id] }))}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer" }}>
                            <div style={{ width: 16, height: 16, borderRadius: 3, border: "2px solid " + (checked ? "#6366f1" : "rgba(255,255,255,0.3)"), background: checked ? "#6366f1" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{checked ? "✓" : ""}</div>
                            <span style={{ fontSize: 13, fontStyle: "italic", color: "#d0cbc4" }}>{word}</span>
                            <span style={{ fontSize: 11, color: "#555" }}>{wordObj.translation}</span>
                          </div>
                        ) : null;
                      })}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => {
                          savingTo.selectedWordIds.forEach(wid => {
                            setWords(prev => prev.map(w => w.id === wid ? { ...w, sentences: [...(w.sentences || []), { en: s.en, sr: s.sr }] } : w));
                          });
                          showToast(`Primer dodat za ${savingTo.selectedWordIds.length} reč${savingTo.selectedWordIds.length > 1 ? "i" : ""} ✓`);
                          setSavingTo(null);
                        }} disabled={savingTo.selectedWordIds.length === 0}
                          style={{ background: savingTo.selectedWordIds.length > 0 ? "#6366f1" : "#2a2a3e", border: "none", color: savingTo.selectedWordIds.length > 0 ? "#fff" : "#555", padding: "6px 14px", borderRadius: 6, cursor: savingTo.selectedWordIds.length > 0 ? "pointer" : "default", fontSize: 12, fontFamily: "monospace" }}>
                          Sačuvaj
                        </button>
                        <button onClick={() => setSavingTo(null)} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Odustani</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setSavingTo({ sentenceIndex: i, selectedWordIds: [] })}
                      style={{ background: "none", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>
                      + sačuvaj primer
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setCombineResult(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>✕ zatvori</button>
            </div>
          )}

          {filteredWords.length === 0 ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📖</div>
              <div>Nema reči. Klikni + DODAJ!</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredWords.map(w => (
                <div key={w.id}
                  onClick={() => {
                    if (combineMode) {
                      setSelectedIds(prev => prev.includes(w.id) ? prev.filter(id => id !== w.id) : [...prev, w.id]);
                    } else {
                      setSelected(w); setView("detail"); fetchImage(w.word, w.imageUrl, w.id);
                    }
                  }}
                  style={{ background: combineMode && selectedIds.includes(w.id) ? "linear-gradient(135deg, #312e81, #4338ca)" : w.status === "known" ? "linear-gradient(135deg, #14532d, #166534)" : w.status === "learning" ? "linear-gradient(135deg, #4a0d1f, #6b1530)" : "linear-gradient(135deg, #1e3a5f, #1e3a8a)", border: "2px solid " + (combineMode && selectedIds.includes(w.id) ? "#818cf8" : w.status === "known" ? "#4ade80" : w.status === "learning" ? "#e11d48" : "#60a5fa"), borderRadius: 12, padding: "12px 16px", cursor: "pointer", display: "flex", flexDirection: "column", boxShadow: combineMode && selectedIds.includes(w.id) ? "0 0 16px rgba(129,140,248,0.4)" : "none", transition: "all 0.15s" }}
                  onMouseEnter={e => { if (!combineMode) e.currentTarget.style.opacity = "0.9"; }}
                  onMouseLeave={e => { if (!combineMode) e.currentTarget.style.opacity = "1"; }}>
                  {/* Tekst: reč + IPA + prevod */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: combineMode ? 0 : 8 }}>
                    {combineMode && (
                      <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid " + (selectedIds.includes(w.id) ? "#818cf8" : "rgba(255,255,255,0.3)"), background: selectedIds.includes(w.id) ? "#6366f1" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: "#fff" }}>
                        {selectedIds.includes(w.id) ? "✓" : ""}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                        <div style={{ fontSize: 17, fontStyle: "italic", fontWeight: 700, color: "#fff" }}>{w.word}</div>
                        {w.ipa && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>{w.ipa}</div>}
                      </div>
                      {w.translation && <div style={{ fontSize: 12, color: "#fff" }}>{w.translation}</div>}
                    </div>
                  </div>
                  {/* Kružići u posebnom redu */}
                  {!combineMode && (
                    <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                      {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                        <div key={s} style={{ position: "relative" }}>
                          <button onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }}
                            style={{ background: w.status === s ? color : "transparent", border: "1px solid " + (w.status === s ? color : "rgba(255,255,255,0.2)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                            onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }}
                            onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}
                          >{label}</button>
                          <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                        </div>
                      ))}
                      <div style={{ position: "relative" }}>
                        <button onClick={e => { e.stopPropagation(); if (window.confirm(`Obrisati "${w.word}"?`)) deleteWord(w.id); }}
                          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.3)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.3)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                        <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FAB — fixed bottom add button, only on list view */}
      {view === "list" && !combineMode && (
        <button onClick={() => { setView("add"); setWordInput(""); setAiData(null); setNotes(""); }}
          style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#d97706", border: "none", color: "#fff", padding: "14px 36px", borderRadius: 50, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 2, boxShadow: "0 4px 24px rgba(217,119,6,0.5)", zIndex: 100, whiteSpace: "nowrap" }}>
          + DODAJ REČ
        </button>
      )}
      {view === "list" && combineMode && (
        <button onClick={generateCombined} disabled={selectedIds.length < 2 || combineLoading}
          style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: selectedIds.length >= 2 ? "#6366f1" : "#2a2a3e", border: "none", color: selectedIds.length >= 2 ? "#fff" : "#555", padding: "14px 36px", borderRadius: 50, cursor: selectedIds.length >= 2 ? "pointer" : "default", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, boxShadow: selectedIds.length >= 2 ? "0 4px 24px rgba(99,102,241,0.5)" : "none", zIndex: 100, whiteSpace: "nowrap", transition: "all 0.2s" }}>
          {combineLoading ? "⟳ Generišem..." : selectedIds.length < 2 ? `Označi min. 2 reči (${selectedIds.length})` : `⊕ Generiši primere (${selectedIds.length})`}
        </button>
      )}

      <style>{`* { outline: none; } input, textarea { transition: border-color 0.2s; } input:focus, textarea:focus { border-color: #6366f1 !important; } input::placeholder, textarea::placeholder { color: #444; }`}</style>
    </div>
  );
}

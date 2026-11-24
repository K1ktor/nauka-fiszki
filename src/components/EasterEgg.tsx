import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Easter egg ekranu „Dziś”: postać wystaje zza prawego dolnego rogu. Po kliknięciu
 * wyskakuje, zaznacza kilka okienek zielonymi kółkami, przyciąga je do siebie,
 * ciska nimi o podłogę, uderza w nie i ucieka. Wszystko wraca na miejsce –
 * animacja jest czysto wizualna (Web Animations API, bez zmian w DOM Reacta i w danych).
 *
 * Grafika i dźwięki leżą w `src/assets/easter-egg/` i są podmienialne (zachowaj nazwy):
 * postac.png (albo .webp/.gif/.svg/.jpg; bez pliku rysuje się wbudowana postać SVG),
 * chwyt / przyciaganie / uderzenie / ult / smiech (.mp3, .ogg albo .wav).
 */

const custom = import.meta.glob("../assets/easter-egg/postac.{png,webp,gif,svg,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const CUSTOM_SRC: string | undefined = Object.values(custom)[0];

const soundFiles = import.meta.glob("../assets/easter-egg/{chwyt,przyciaganie,uderzenie,ult,smiech}.{mp3,ogg,wav}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
type Sound = "chwyt" | "przyciaganie" | "uderzenie" | "ult" | "smiech";
const SOUNDS: Partial<Record<Sound, string>> = {};
for (const [path, url] of Object.entries(soundFiles)) {
  const name = path.split("/").pop()!.replace(/\.[^.]+$/, "") as Sound;
  SOUNDS[name] ??= url;
}

/** Odtwarza dźwięk easter egga; brak pliku albo zablokowane audio po cichu ignorujemy. */
function play(name: Sound, volume = 0.8) {
  const url = SOUNDS[name];
  if (!url) return;
  try {
    const a = new Audio(url);
    a.volume = volume;
    void a.play().catch(() => {});
  } catch {
    /* brak audio – trudno */
  }
}

/** Kandydaci na „ofiary” – od najciekawszych. */
const TARGETS = [".dashboard .ring", ".dashboard .plan-mode", ".dashboard .m-tile", ".dashboard .forecast", ".dashboard .streak-info", ".dashboard .mini-heat", ".dashboard .mastery-bar"];
const MAX_TARGETS = 4;
/** Kółka: czas rysowania jednego, odstęp między kolejnymi, średnica (px) – taka sama dla wszystkich. */
const RING_MS = 520;
const RING_STAGGER = 180;
const RING_D = 150;

type Phase = "peek" | "hidden" | "run";
type Pose = "idle" | "jump" | "grab" | "slam" | "flee";

interface Victim {
  el: HTMLElement;
  rect: DOMRect;
  cx: number;
  cy: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function pickVictims(): Victim[] {
  const vh = window.innerHeight;
  const found: HTMLElement[] = [];
  for (const sel of TARGETS) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20 || r.bottom < 0 || r.top > vh) continue;
      if (found.some((f) => f.contains(el) || el.contains(f))) continue;
      found.push(el);
    }
  }
  // Losowo, ale zawsze z pierścieniem planu, jeśli jest widoczny.
  const [first, ...rest] = found;
  const shuffled = rest.sort(() => Math.random() - 0.5);
  return (first ? [first, ...shuffled] : shuffled).slice(0, MAX_TARGETS).map((el) => {
    const rect = el.getBoundingClientRect();
    return { el, rect, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  });
}

export default function EasterEgg() {
  const [phase, setPhase] = useState<Phase>("peek");
  const [pose, setPose] = useState<Pose>("idle");
  const [victims, setVictims] = useState<Victim[]>([]);
  const [rings, setRings] = useState(false);
  const [tethers, setTethers] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const hand = useRef({ x: 0, y: 0 });
  const alive = useRef(true);
  const running = useRef<Animation[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      running.current.forEach((a) => a.cancel());
    };
  }, []);

  const track = (a: Animation) => {
    running.current.push(a);
    return a;
  };

  const start = async () => {
    if (phase !== "peek") return;
    const picked = pickVictims();
    setVictims(picked);
    setPhase("run");
    setPose("jump");
    play("ult");
    await wait(30);
    const hero = heroRef.current;
    if (!hero || !alive.current) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const heroW = hero.offsetWidth;
    const heroH = hero.offsetHeight;
    // Stanowisko bohatera: dół ekranu, mniej więcej na środku treści.
    const content = document.querySelector(".content")?.getBoundingClientRect();
    const midX = content ? content.left + content.width / 2 : vw / 2;
    const standX = midX - heroW / 2;
    const standY = vh - heroH - 8;
    const from = `translate(${vw - heroW * 0.55}px, ${vh - heroH * 0.75}px) rotate(-18deg)`;
    const at = (x: number, y: number, extra = "") => `translate(${x}px, ${y}px) ${extra}`;

    if (reducedMotion()) {
      // Wersja łagodna: bez skoków i przesuwania okienek, tylko kółka.
      hero.animate([{ opacity: 0, transform: at(standX, standY) }, { opacity: 1, transform: at(standX, standY) }], { duration: 300, fill: "forwards" });
      setRings(true);
      await wait(1800);
      setRings(false);
      hero.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      await wait(350);
      return finish();
    }

    // Pozycja w powietrzu, z której bohater zaznacza i przyciąga okienka.
    const airY = Math.max(16, vh * 0.3 - heroH / 2);
    hand.current = { x: midX + heroW * 0.3, y: airY + heroH * 0.35 };

    // 1. Wyskok zza rogu wysoko w powietrze (zawisa nad treścią).
    await track(
      hero.animate(
        [
          { transform: from },
          { transform: at((vw + standX) / 2, airY - vh * 0.12, "rotate(260deg)"), offset: 0.6 },
          { transform: at(standX, airY - 10, "rotate(360deg)"), offset: 0.88 },
          { transform: at(standX, airY, "rotate(360deg)") },
        ],
        { duration: 850, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" },
      ),
    ).finished;
    if (!alive.current) return;
    const hover = track(
      hero.animate([{ transform: at(standX, airY) }, { transform: at(standX, airY - 8) }, { transform: at(standX, airY) }], {
        duration: 700,
        iterations: Infinity,
        easing: "ease-in-out",
      }),
    );

    // 2. Zaznaczenie zielonymi kółkami, które rysują się zgodnie z ruchem wskazówek zegara.
    setPose("grab");
    setRings(true);
    play("chwyt");
    await wait(RING_MS + (picked.length - 1) * RING_STAGGER + 150);
    setTethers(true);
    await wait(350);
    if (!alive.current) return;

    // 3. Przyciąganie: okienka lecą w górę do bohatera wiszącego w powietrzu.
    setRings(false);
    setTethers(false);
    picked.forEach((v) =>
      track(
        v.el.animate([{ outline: "4px solid #22c55e", outlineOffset: "6px", boxShadow: "0 0 22px 6px rgba(34,197,94,.6)" }], {
          duration: 1,
          fill: "forwards",
          composite: "replace",
        }),
      ),
    );
    play("przyciaganie");
    const pullTo = picked.map((v, i) => {
      const spread = (i - (picked.length - 1) / 2) * Math.min(150, vw / 8);
      const tx = midX + spread - v.cx;
      const ty = airY + heroH * 0.6 + (i % 2) * 30 - v.cy;
      return { tx, ty, rot: (Math.random() - 0.5) * 30 };
    });
    const pulls = picked.map((v, i) =>
      track(
        v.el.animate(
          [{ transform: "none" }, { transform: `translate(${pullTo[i].tx}px, ${pullTo[i].ty}px) rotate(${pullTo[i].rot}deg) scale(0.8)` }],
          { duration: 650, delay: i * 60, easing: "cubic-bezier(.6,-0.3,.4,1.2)", fill: "forwards" },
        ),
      ),
    );
    await Promise.all(pulls.map((p) => p.finished));
    if (!alive.current) return;
    await wait(200);

    // 4. Jedno uderzenie z powietrza w ziemię – bohater nurkuje razem z okienkami.
    hover.cancel();
    setPose("slam");
    const floor = picked.map((v, i) => {
      const h = v.rect.height * 0.8;
      return { tx: pullTo[i].tx, ty: vh - 6 - h / 2 - v.cy, rot: pullTo[i].rot * 0.3 };
    });
    track(
      hero.animate(
        [
          { transform: at(standX, airY) },
          { transform: at(standX, airY - 40, "rotate(-12deg)"), offset: 0.3 },
          { transform: at(standX, standY + 10, "scale(1.15, 0.8)"), offset: 0.85 },
          { transform: at(standX, standY) },
        ],
        { duration: 520, easing: "cubic-bezier(.6,0,.9,.5)", fill: "forwards" },
      ),
    );
    const slams = picked.map((v, i) => {
      const a = v.el.animate(
        [
          { transform: `translate(${pullTo[i].tx}px, ${pullTo[i].ty}px) rotate(${pullTo[i].rot}deg) scale(0.8)` },
          { transform: `translate(${pullTo[i].tx}px, ${pullTo[i].ty - 40}px) rotate(${pullTo[i].rot}deg) scale(0.8)`, offset: 0.3 },
          { transform: `translate(${floor[i].tx}px, ${floor[i].ty}px) rotate(${floor[i].rot}deg) scale(0.86, 0.68)`, offset: 0.85 },
          { transform: `translate(${floor[i].tx}px, ${floor[i].ty}px) rotate(${floor[i].rot}deg) scale(0.8)` },
        ],
        { duration: 520, easing: "cubic-bezier(.6,0,.9,.5)", fill: "forwards" },
      );
      pulls[i].cancel();
      return track(a);
    });
    await wait(440);
    if (!alive.current) return;
    play("uderzenie", 1);
    const app = document.querySelector<HTMLElement>(".app");
    if (app) track(app.animate(shake(16), { duration: 480 }));
    await Promise.all(slams.map((s) => s.finished));
    await wait(450);
    if (!alive.current) return;

    // 5. Ucieczka: wystrzał jak pocisk z katapulty – przysiad, potem lot po paraboli poza ekran.
    setPose("flee");
    const endX = -heroW - 80;
    const endY = vh * 0.45;
    const peak = standY - Math.max(40, vh * 0.04); // jak wysoko ponad linię start–koniec
    const arc: Keyframe[] = [{ transform: at(standX, standY), offset: 0 }, { transform: at(standX + 10, standY + 14, "scale(1.15, 0.75)"), offset: 0.14 }];
    const STEPS = 14;
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      const x = standX + (endX - standX) * t;
      const y = standY + (endY - standY) * t - 4 * peak * t * (1 - t);
      arc.push({ transform: at(x, y, `rotate(${-720 * t}deg)`), offset: 0.2 + 0.8 * t });
    }
    const flee = track(hero.animate(arc, { duration: 1300, easing: "linear", fill: "forwards" }));
    setTimeout(() => alive.current && play("uderzenie", 0.35), 260);
    setTimeout(() => alive.current && play("smiech"), 380);
    const backs = picked.map((v, i) => {
      const a = v.el.animate(
        [
          { transform: `translate(${floor[i].tx}px, ${floor[i].ty}px) rotate(${floor[i].rot}deg) scale(0.8)` },
          { transform: "translate(0, -10px) scale(1.03)", offset: 0.8 },
          { transform: "none" },
        ],
        { duration: 800, delay: 500 + i * 80, easing: "cubic-bezier(.3,1.3,.5,1)", fill: "backwards" },
      );
      slams[i].cancel();
      return track(a);
    });
    await Promise.all([flee.finished, ...backs.map((b) => b.finished)]);
    finish();
  };

  const finish = () => {
    if (!alive.current) return;
    running.current.forEach((a) => a.cancel());
    running.current = [];
    setRings(false);
    setTethers(false);
    setVictims([]);
    setPose("idle");
    // Po ucieczce znika do następnego (wylosowanego) wejścia na „Dziś”.
    setPhase("hidden");
  };

  if (phase === "hidden") return null;

  return createPortal(
    <>
      {phase === "run" && <div className="egg-blocker" />}
      {rings &&
        victims.map((v, i) => {
          const d = RING_D;
          return (
            <svg key={i} className="egg-ring" width={d} height={d} viewBox="0 0 100 100" style={{ left: v.cx - d / 2, top: v.cy - d / 2 }}>
              <circle className="egg-ring-track" cx="50" cy="50" r="46" />
              <circle
                className="egg-ring-fill"
                cx="50"
                cy="50"
                r="46"
                pathLength={100}
                transform="rotate(-90 50 50)"
                style={{ animationDuration: `${RING_MS}ms`, animationDelay: `${i * RING_STAGGER}ms` }}
              />
            </svg>
          );
        })}
      {tethers && (
        <svg className="egg-tethers" width="100%" height="100%">
          {victims.map((v, i) => (
            <line key={i} x1={hand.current.x} y1={hand.current.y} x2={v.cx} y2={v.cy} />
          ))}
        </svg>
      )}
      {phase === "peek" ? (
        <button className="egg-peek" onClick={start} title="Hmm… kto to?" aria-label="Niespodzianka">
          <Hero pose="idle" />
        </button>
      ) : (
        <div ref={heroRef} className="egg-hero">
          <Hero pose={pose} />
        </div>
      )}
    </>,
    document.body,
  );
}

function shake(px: number): Keyframe[] {
  return [0, -1, 0.8, -0.6, 0.4, -0.2, 0].map((k) => ({ transform: `translate(${k * px}px, ${-k * px * 0.5}px)` }));
}

function Hero({ pose }: { pose: Pose }) {
  if (CUSTOM_SRC) return <img className={`egg-img pose-${pose}`} src={CUSTOM_SRC} alt="" draggable={false} />;
  return <Rascal pose={pose} />;
}

/** Wbudowana, oryginalna postać: Zbójek – czapka z pomponem, gogle, zielony szalik, wielka rękawica. */
function Rascal({ pose }: { pose: Pose }) {
  return (
    <svg className={`egg-svg pose-${pose}`} viewBox="0 0 120 160" aria-hidden="true">
      {/* nogi */}
      <g className="egg-legs">
        <rect x="42" y="122" width="13" height="28" rx="6" fill="#2b2d42" />
        <rect x="65" y="122" width="13" height="28" rx="6" fill="#2b2d42" />
        <ellipse cx="47" cy="152" rx="11" ry="6" fill="#1b1b1f" />
        <ellipse cx="73" cy="152" rx="11" ry="6" fill="#1b1b1f" />
      </g>
      {/* tułów – bluza */}
      <path d="M30 92 Q30 74 60 74 Q90 74 90 92 L92 128 Q60 136 28 128 Z" fill="#7c3aed" />
      <path d="M52 100 h16 v14 h-16 z" fill="#6d28d9" />
      {/* lewa ręka */}
      <path className="egg-arm-l" d="M32 88 Q16 100 20 116" stroke="#7c3aed" strokeWidth="11" fill="none" strokeLinecap="round" />
      {/* prawa ręka z rękawicą */}
      <g className="egg-arm-r">
        <path d="M88 88 Q104 96 104 108" stroke="#7c3aed" strokeWidth="11" fill="none" strokeLinecap="round" />
        <circle cx="105" cy="112" r="11" fill="#f97316" />
        <rect x="96" y="102" width="9" height="7" rx="3" fill="#fdba74" />
      </g>
      {/* szalik */}
      <path d="M38 76 Q60 88 82 76 L84 84 Q60 96 36 84 Z" fill="#22c55e" />
      <path d="M72 84 l10 22 l-9 2 l-8 -20 z" fill="#16a34a" />
      {/* głowa */}
      <circle cx="60" cy="52" r="26" fill="#f5c9a0" />
      <ellipse cx="44" cy="62" rx="5" ry="3" fill="#f59e8b" opacity="0.6" />
      <ellipse cx="76" cy="62" rx="5" ry="3" fill="#f59e8b" opacity="0.6" />
      {/* oczy + brwi (zawadiackie) */}
      <circle cx="50" cy="54" r="3.4" fill="#1d1c1a" />
      <circle cx="70" cy="54" r="3.4" fill="#1d1c1a" />
      <path d="M44 46 l11 3 M76 46 l-11 3" stroke="#1d1c1a" strokeWidth="3" strokeLinecap="round" />
      {/* uśmiech */}
      <path className="egg-mouth" d="M51 65 Q60 72 69 64" stroke="#1d1c1a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      {/* czapka z goglami */}
      <path d="M33 44 Q34 18 60 18 Q86 18 87 44 Z" fill="#ea580c" />
      <rect x="32" y="38" width="56" height="8" rx="4" fill="#c2410c" />
      <circle cx="60" cy="15" r="7" fill="#fde68a" />
      <rect x="40" y="29" width="40" height="5" fill="#334155" />
      <circle cx="49" cy="31" r="7" fill="#94a3b8" stroke="#334155" strokeWidth="3" />
      <circle cx="71" cy="31" r="7" fill="#94a3b8" stroke="#334155" strokeWidth="3" />
      <circle cx="47" cy="29" r="2" fill="#fff" />
      <circle cx="69" cy="29" r="2" fill="#fff" />
    </svg>
  );
}

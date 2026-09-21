import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

/*
 * Majori intro — two dark pages before the verification form:
 *
 *   Page 1 (dark): the brand bird + "Majori." wordmark, big and centered.
 *   Page 2 (dark): the pitch (one sentence) + Instagram follow button.
 *
 * The logo is ONE element throughout. It lives in page 2's DOM (its natural
 * spot is page 2's top, small), and its initial state is parked over page 1 —
 * centered and magnified by a pure-CSS transform (translateY + scale), so the
 * very first paint is already correct (SSR-safe) and the flip-in entrance
 * runs on it. Scrolling to page 2 is one smooth GSAP glide that simultaneously
 * carries the SAME logo up to page 2's top and shrinks it to rest — it never
 * disappears and nothing is recreated. The pitch fades in beneath it.
 *
 * Scroll-up gestures are ignored; every dark page unmounts once left, so
 * neither can ever be scrolled back to.
 *
 * Animation references (ported faithfully):
 * - Word flip-in: agency-portfolio-master components/Hero.tsx ("We Build What
 *   Ships") — words go fromTo({ y, rotateX: -80, opacity: 0 } -> { y: 0,
 *   rotateX: 0, opacity: 1 }, ease power4.out, stagger), inside a parent with
 *   `perspective`. Applied per-letter to the wordmark.
 * - Wordmark markup: majori components/majori/wordmark.tsx verbatim — "Majori."
 *   as ONE element, the dot in majori-coral (#7c3aed), no whitespace.
 * - Font: Sora, the same display font the portfolio headers use.
 *
 * All animations play regardless of the user's reduced-motion preference
 * (explicit product requirement).
 */
gsap.registerPlugin(ScrollToPlugin);

const MAJORI_CHARS = ["M", "a", "j", "o", "r", "i"];

const LETTER_START: React.CSSProperties = {
  opacity: 0,
  transform: "translateY(60px) rotateX(-80deg)",
};

export default function Intro({
  targetRef,
  onDone,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  onDone: () => void;
}) {
  const page1Ref = useRef<HTMLElement>(null); // bare dark backdrop
  const page2Ref = useRef<HTMLElement>(null); // about page (logo top + pitch)
  const logoBlockRef = useRef<HTMLDivElement>(null); // THE logo (shared by both pages)
  const aboutRef = useRef<HTMLDivElement>(null); // sentence + instagram button

  // 0 = pages 1+2 mounted (page 1 at the top) · 1 = page 1 gone, page 2 at the
  // top · 2 = intro over (parent unmounts us, leaving only the form).
  const [stage, setStage] = useState(0);
  const stageRef = useRef(0);
  stageRef.current = stage;

  useEffect(() => {
    const page1 = page1Ref.current;
    const page2 = page2Ref.current;
    if (!page1 || !page2) return;

    const target = targetRef.current;
    if (!target) {
      onDone();
      return;
    }

    // Never let the browser restore a scroll position past the intro.
    window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    let transitioning = false;

    // One smooth glide to the next page. Page 1 -> 2 carries THE logo block
    // from its parked position (centered on page 1, magnified) to its rest
    // position (page 2 top, natural size) — same element, never recreated.
    const startTransition = () => {
      if (transitioning) return;
      transitioning = true;

      if (stageRef.current === 0) {
        const block = logoBlockRef.current;
        // Offset that parks the block's center on page 1's center (page-2 top
        // inset is 2.5rem, block height measured live).
        const shift = -(window.innerHeight / 2 + 40 + (block?.offsetHeight ?? 0) / 2);

        gsap
          .timeline()
          .fromTo(
            block,
            { y: shift, scale: 2.5 },
            { y: 0, scale: 1, duration: 1.2, ease: "power4.inOut" },
            0
          )
          .fromTo(
            aboutRef.current,
            { y: 28, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.9, ease: "power4.out" },
            0.45
          )
          .to(
            window,
            {
              scrollTo: { y: page2, autoKill: false },
              duration: 1.2,
              ease: "power4.inOut",
              // Landing on page 2 unmounts page 1 (it cannot be scrolled back
              // to) and re-arms the transition for the next glide.
              onComplete: () => {
                transitioning = false;
                setStage(1);
              },
            },
            0
          );
      } else {
        gsap.to(window, {
          scrollTo: { y: target, autoKill: false },
          duration: 1.2,
          ease: "power4.inOut",
          onComplete: () => {
            transitioning = false;
            onDone();
          },
        });
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) startTransition();
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (touchStartY - (e.touches[0]?.clientY ?? touchStartY) > 8) startTransition();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ([" ", "ArrowDown", "PageDown"].includes(e.key)) {
        e.preventDefault();
        startTransition();
      } else if (["ArrowUp", "PageUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
      }
    };

    // Fallback: any scroll that slips through funnels into the same glide.
    const onScroll = () => {
      if (transitioning) return;
      if (window.scrollY > 24) startTransition();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, { passive: true });

    // Entrance: bird + big wordmark flip in (on the parked logo, page 1).
    const logo = logoBlockRef.current;
    const logoBird = logo?.querySelector(".intro-bird") ?? null;
    const logoLetters = logo ? Array.from(logo.querySelectorAll(".intro-letter")) : [];
    const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
    tl.fromTo(
      logoBird,
      { scale: 0.9, autoAlpha: 0 },
      { scale: 1, autoAlpha: 1, duration: 0.9, ease: "power2.out" },
      0
    ).fromTo(
      logoLetters,
      { y: 60, rotateX: -80, opacity: 0 },
      { y: 0, rotateX: 0, opacity: 1, duration: 1.1, stagger: 0.07 },
      0.4
    );

    // Failsafe: never hide the brand behind a dead animation.
    const showFailsafe = window.setTimeout(() => {
      gsap.set([logoBird, ...logoLetters], {
        opacity: 1,
        scale: 1,
        y: 0,
        rotateX: 0,
        visibility: "inherit",
      });
    }, 5000);

    return () => {
      window.clearTimeout(showFailsafe);
      tl.kill();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* PAGE 1 — bare dark backdrop (the logo floats over it from page 2) */}
      {stage === 0 && (
        <section
          ref={page1Ref}
          aria-hidden="true"
          className="relative z-40 h-[100dvh] bg-black"
        />
      )}

      {/* PAGE 2 — about page; THE logo at the top, pitch + Instagram below */}
      <section
        ref={page2Ref}
        aria-hidden="true"
        className="relative z-40 flex h-[100dvh] flex-col items-center bg-black px-6 pb-10 pt-10"
      >
        {/*
          The one and only logo. Its natural spot is here (page 2 top, small).
          The initial transform parks it over page 1 (centered, 2.5x) — the
          glide then brings it home; page 1 never has its own copy.
        */}
        <div
          ref={logoBlockRef}
          className="flex select-none flex-col items-center gap-4"
          style={{
            transform: "translateY(calc(-50dvh - 2.5rem - 50%)) scale(2.5)",
            fontFamily: "Sora, ui-sans-serif, system-ui, sans-serif",
          }}
        >
          <img
            src="/brand/bird.png"
            alt=""
            className="intro-bird size-16 rounded-xl object-contain sm:size-24"
            style={{ opacity: 0, transform: "scale(0.9)" }}
          />
          <h1
            className="flex gap-[0.06em] text-3xl leading-none font-bold tracking-[-0.05em] text-white sm:text-5xl"
            style={{ perspective: "1000px" }}
          >
            {MAJORI_CHARS.map((ch, i) => (
              <span key={i} className="intro-letter inline-block" style={LETTER_START}>
                {ch}
              </span>
            ))}
            <span className="intro-letter inline-block text-[#7c3aed]" style={LETTER_START}>
              .
            </span>
          </h1>
        </div>

        <div ref={aboutRef} className="my-auto flex w-full max-w-2xl flex-col items-center" style={{ opacity: 0 }}>
          <p className="text-center text-2xl leading-relaxed text-white/90 sm:text-3xl">
            Majori, la plateforme qui aide les étudiants en médecine d&apos;Algérie à réviser
            et réussir leurs examens grâce à des QCM intelligents.
          </p>
          <a
            href="https://www.instagram.com/majori.qcm.25"
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-[#7c3aed] px-7 py-3.5 text-sm font-bold text-white shadow-[0_0_24px_rgba(124,58,237,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_36px_rgba(124,58,237,0.65)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
            </svg>
            Nous suivre sur Instagram
          </a>
        </div>
      </section>
    </>
  );
}
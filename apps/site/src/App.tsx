import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState } from "react";
import { Download } from "./sections/Download.tsx";
import { Features } from "./sections/Features.tsx";
import { Files } from "./sections/Files.tsx";
import { DownloadButton, Hero } from "./sections/Hero.tsx";
import { Learn } from "./sections/Learn.tsx";
import { Local } from "./sections/Local.tsx";
import { Manifesto } from "./sections/Manifesto.tsx";
import { Faq, Footer, Marquee } from "./sections/More.tsx";
import { Sees } from "./sections/Sees.tsx";
import { Logo } from "./ui/Logo.tsx";

export function App() {
  return (
    <div className="grain overflow-x-clip">
      <Intro />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Manifesto />
        <Sees />
        <Features />
        <Learn />
        <Files />
        <Local />
        <Faq />
        <Download />
      </main>
      <Footer />
    </div>
  );
}

/** Lifts the static intro in index.html once the mark has drawn itself (about a second after load). */
function Intro() {
  useEffect(() => {
    const el = document.getElementById("intro");
    if (!el) return;
    const lift = window.setTimeout(() => el.classList.add("out"), Math.max(0, 1100 - performance.now()));
    const gone = window.setTimeout(() => el.remove(), Math.max(0, 1100 - performance.now()) + 800);
    return () => {
      window.clearTimeout(lift);
      window.clearTimeout(gone);
    };
  }, []);
  return null;
}

function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 40));
  return (
    <motion.header
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 20, delay: 1.2 }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3"
    >
      <motion.nav
        animate={{
          maxWidth: scrolled ? 760 : 1180,
          backgroundColor: scrolled ? "rgba(26,26,25,0.72)" : "rgba(26,26,25,0)",
          borderColor: scrolled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0)",
        }}
        transition={{ type: "spring", stiffness: 200, damping: 30 }}
        className="flex w-full items-center justify-between rounded-full border py-2 pr-2 pl-4 backdrop-blur-xl"
      >
        <a href="/" aria-label="Cutroom">
          <Logo />
        </a>
        <div className="hidden items-center gap-7 text-[14px] text-muted sm:flex">
          <a href="#sees" className="hover:text-fg">
            How it sees
          </a>
          <a href="#learn" className="hover:text-fg">
            Learn a style
          </a>
          <a href="#features" className="hover:text-fg">
            Features
          </a>
          <a href="#faq" className="hover:text-fg">
            FAQ
          </a>
        </div>
        <div className="origin-right scale-[0.82]">
          <DownloadButton />
        </div>
      </motion.nav>
    </motion.header>
  );
}

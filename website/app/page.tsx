import Navbar from "@/components/navbar";
import Hero from "@/components/hero";
import TerminalDemo from "@/components/terminal-demo";
import Features from "@/components/features";
import TlispShowcase from "@/components/tlisp-showcase";
import Architecture from "@/components/architecture";
import Footer from "@/components/footer";

export default function Home() {
  return (
    <main>
      <Navbar />
      <Hero />
      <TerminalDemo />
      <Features />
      <TlispShowcase />
      <Architecture />
      <Footer />
    </main>
  );
}

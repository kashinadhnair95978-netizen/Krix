import { Navbar } from '@/components/landing/Navbar';
import { Hero } from '@/components/landing/Hero';
import { TrustedBy } from '@/components/landing/TrustedBy';
import { Capabilities } from '@/components/landing/Capabilities';
import { Solutions } from '@/components/landing/Solutions';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Pricing } from '@/components/landing/Pricing';
import { Testimonials } from '@/components/landing/Testimonials';
import { FAQ } from '@/components/landing/FAQ';
import { CTA } from '@/components/landing/CTA';
import { Footer } from '@/components/landing/Footer';

export default function Home() {
  return (
    <main className="bg-black text-white">
      <Navbar />
      <Hero />
      <CTA />
      <TrustedBy />
      <Capabilities />
      <Solutions />
      <HowItWorks />
      <Pricing />
      <Testimonials />
      <FAQ />
      <Footer />
    </main>
  );
}
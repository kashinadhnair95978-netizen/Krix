const brands = [
  'Vantage Media',
  'PodLab',
  'Streamline',
  'Northbeam',
  'CreatorHQ',
  'Unfold',
  'Signal Story',
  'Brightwave',
  'Studio One',
  'Novelty',
];

export function TrustedBy() {
  return (
    <section className="border-y border-white/5 bg-white/[0.01] py-10">
      <p className="mx-auto max-w-5xl px-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
        Trusted by 10,000+ creators &amp; production teams
      </p>
      <div className="mt-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        <div className="flex w-max animate-marquee-x items-center gap-14 whitespace-nowrap">
          {[...brands, ...brands].map((brand, i) => (
            <span
              key={`${brand}-${i}`}
              className="text-lg font-semibold tracking-tight text-neutral-600 transition-colors hover:text-neutral-300"
            >
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
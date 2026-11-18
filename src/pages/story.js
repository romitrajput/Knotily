import { config } from '../config.js';
import { formatPrice } from '../lib/util.js';

export default async function story() {
  return {
    name: 'story',
    title: 'Story',
    description: "Why Knot’ily makes clothes you tie yourself, in small drops that never come back.",
    html: `
    <section class="story-hero">
      <h1 class="display">Made to be undone</h1>
      <p class="lede">Knot’ily started with one question: how much do you want to show tonight? Every piece has a lace-up, a drawcord or a strap you control, so the final fit is yours to decide.</p>
    </section>

    <section class="section story-cols">
      <article>
        <h2>Why strings</h2>
        <p>A drawcord or a lace lets one piece sit high or low, tight or loose. It's the cheapest way to own more outfits without buying more clothes.</p>
      </article>
      <article>
        <h2>Why drops</h2>
        <p>We cut each style in short runs. When a colour sells out we retire it, so the rail never fills with leftovers and you rarely meet your outfit twin.</p>
      </article>
      <article>
        <h2>Why it feels good</h2>
        <p>Heavyweight cotton, washed rib, brushed fleece, ripstop. We choose fabric for how it feels on skin first and how it photographs second.</p>
      </article>
    </section>

    <section class="section info" id="sizing" aria-labelledby="size-title">
      <h2 id="size-title" class="display-sm">Sizing</h2>
      <p>Sizes run XS to XL, and the ties give every piece a few centimetres of play. If you're between sizes, take the smaller one. Each product page has a size guide with chest, waist and hip measurements.</p>
    </section>

    <section class="section info" id="shipping" aria-labelledby="ship-title">
      <h2 id="ship-title" class="display-sm">Shipping and returns</h2>
      <p>We ship across India. Orders over ${formatPrice(config.freeShippingThreshold)} ship free; below that it's ${formatPrice(config.shippingFee)}. Most orders leave the studio in 2–3 working days. Pay online with UPI, cards, net banking or wallets.</p>
      <p>Return unworn pieces with tags within 7 days of delivery for a refund to your original payment method.</p>
      <a class="btn" href="/shop">Shop ${config.currentDrop}</a>
    </section>`,
  };
}

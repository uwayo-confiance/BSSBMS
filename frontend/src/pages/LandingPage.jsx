import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  Beer,
  Boxes,
  Check,
  ClipboardList,
  HandCoins,
  Menu,
  Package,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';

const features = [
  { icon: Boxes, title: 'Stock Control', description: 'Know what is available, what is running low and what needs restocking.' },
  { icon: ShoppingCart, title: 'Sales Tracking', description: 'Record transactions, monitor sales and keep accurate payment records.' },
  { icon: Truck, title: 'Purchase Management', description: 'Organize supplier information, record incoming purchases and monitor payments.' },
  { icon: Wallet, title: 'Financial Monitoring', description: 'Track income, expenses and outstanding balances to understand your business performance.' },
  { icon: Users, title: 'Customer Records', description: 'Keep customer information and payment records organized.' },
  { icon: BarChart3, title: 'Business Reporting', description: 'Turn business transactions into meaningful reports that support better decisions.' },
];

const benefits = [
  'Simple and user-friendly design',
  'Centralized business information',
  'Accurate inventory records',
  'Organized financial management',
  'Improved operational efficiency',
  'Secure access for authorized users',
  'Clear business performance reports',
];

const navigation = [
  ['Home', '#home'],
  ['About', '#about'],
  ['Solutions', '#solutions'],
  ['Features', '#features'],
  ['Contact', '#contact'],
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div id="home" className="min-h-screen overflow-hidden bg-white text-stone-800">
      <header className="absolute inset-x-0 top-0 z-20 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between rounded-2xl border border-white/80 bg-white/90 px-4 shadow-sm backdrop-blur-md sm:px-6">
          <a href="#home" onClick={closeMenu} aria-label="BSSBMS home" className="flex items-center gap-2.5 font-extrabold tracking-tight text-stone-800">
            <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-bms-primary text-white shadow-sm"><Beer size={20} /></span>
            <span className="text-lg leading-tight">BSS<span className="text-bms-primary">BMS</span><small className="block pt-1 text-[8px] font-semibold tracking-[.12em] text-stone-400">Your Business, Smarter and More Organized.</small></span>
          </a>
          <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
            {navigation.map(([label, href]) => <a key={label} href={href} className="text-sm font-medium text-stone-600 transition hover:text-bms-primary">{label}</a>)}
            <Link to="/login" className="inline-flex items-center gap-2 rounded-lg bg-bms-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-900/15 transition hover:-translate-y-0.5 hover:bg-bms-primary-hover">Sign In <ArrowRight size={15} /></Link>
          </nav>
          <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" className="flex size-10 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 md:hidden">
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
          {menuOpen && <nav id="mobile-navigation" aria-label="Mobile navigation" className="absolute left-3 right-3 top-[4.75rem] flex flex-col rounded-xl border border-stone-100 bg-white p-3 shadow-xl md:hidden">
            {navigation.map(([label, href]) => <a key={label} href={href} onClick={closeMenu} className="border-b border-stone-100 px-3 py-3 text-sm font-medium text-stone-600 last:border-0">{label}</a>)}
            <Link to="/login" onClick={closeMenu} className="px-3 py-3 text-sm font-semibold text-bms-primary">Sign In</Link>
          </nav>}
        </div>
      </header>

      <main>
        <section className="relative bg-[radial-gradient(ellipse_at_50%_72%,rgba(251,196,128,.48),transparent_63%),linear-gradient(180deg,#fffdfa_0%,#fffaf5_56%,#fff0df_100%)] px-4 pb-0 pt-32 text-center sm:px-6 sm:pt-36">
          <div className="mx-auto max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-white/75 px-3.5 py-1.5 text-[10px] font-bold tracking-[.04em] text-bms-primary"><Sparkles size={13} /> Your Business, Smarter and More Organized.</span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-[-.045em] text-stone-800 sm:text-5xl lg:text-6xl">Run Your Business<br className="hidden sm:block" /> <span className="text-bms-primary">with Confidence</span></h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">Take control of your daily business operations with BSSBMS, an all-in-one management platform that helps you organize stock, manage sales, monitor purchases and track financial performance.</p>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">Make your business operations easier, faster and more reliable.</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link to="/login" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-bms-primary px-6 text-sm font-bold text-white shadow-lg shadow-amber-900/15 transition hover:-translate-y-0.5 hover:bg-bms-primary-hover">Start Managing <ArrowRight size={16} /></Link>
              <a href="#features" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-stone-200 bg-white/80 px-6 text-sm font-semibold text-stone-700 transition hover:border-amber-300 hover:bg-white">Explore Features <ArrowDownRight size={16} /></a>
            </div>
          </div>
        </section>

        <section id="about" className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2 lg:gap-20">
          <div className="relative flex min-h-64 items-center justify-center rounded-3xl bg-[radial-gradient(ellipse_at_center,#fceddd_0%,#fff9f3_55%,#fff_78%)] sm:min-h-80">
            <div className="-rotate-3 rounded-2xl border border-amber-100 bg-white p-6 shadow-xl shadow-stone-200/60 sm:w-72">
              <span className="text-[10px] font-bold tracking-widest text-stone-400">TODAY&apos;S SALES</span>
              <b className="mt-2 block text-3xl tracking-tight text-stone-800">428,500 <small className="text-sm font-medium text-stone-400">RWF</small></b>
              <span className="mt-1 flex items-center gap-1 text-xs text-green-600"><TrendingUp size={14} /> Growing steadily</span>
              <div className="mt-5 flex h-12 items-end gap-2 border-b border-stone-100">{[35, 54, 43, 78, 60, 90, 67, 82, 48, 96, 73, 100].map((height, index) => <i key={index} style={{ height: `${height}%` }} className="flex-1 rounded-t bg-gradient-to-t from-amber-400 to-amber-200" />)}</div>
            </div>
            <div className="absolute bottom-7 right-2 flex -rotate-2 items-center gap-3 rounded-xl border border-stone-100 bg-white px-4 py-3 shadow-lg sm:right-8">
              <span className="flex size-9 items-center justify-center rounded-lg bg-green-50 text-green-600"><Check size={18} /></span><span><b className="block text-xs text-stone-700">Stock is up to date</b><small className="text-[10px] text-stone-400">Inventory checked just now</small></span>
            </div>
            <span className="absolute right-[15%] top-8 flex size-14 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-amber-400 to-bms-primary text-white shadow-lg"><Beer size={24} /></span>
          </div>
          <div>
            <span className="text-xs font-bold tracking-[.15em] text-bms-primary">INTRODUCTION</span>
            <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-stone-800 sm:text-4xl">A Smarter Way to Manage Your Business</h2>
            <p className="mt-5 text-sm leading-7 text-stone-600 sm:text-base">Managing a business should not be complicated. BSSBMS provides a centralized platform where business owners and employees can manage their daily activities without depending on manual records and paperwork.</p>
            <p className="mt-3 text-sm leading-7 text-stone-600 sm:text-base">From stock monitoring to financial reporting, everything is organized in one place.</p>
            <a href="#solutions" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-bms-primary hover:gap-3">Explore our solutions <ArrowRight size={16} /></a>
          </div>
        </section>

        <section id="solutions" className="border-y border-stone-100 bg-bms-cream/40 px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-11 max-w-2xl text-center">
              <span className="text-xs font-bold tracking-[.15em] text-bms-primary">OUR SOLUTIONS</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-800 sm:text-4xl">Everything Connected. Everything Under Control.</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, description }, index) => (
                <article key={title} className="group rounded-2xl border border-stone-200/80 bg-white p-5 transition hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg hover:shadow-amber-100/60">
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-bms-primary transition group-hover:bg-bms-primary group-hover:text-white"><Icon size={21} strokeWidth={1.8} /></span>
                    <span className="text-xs font-bold tracking-widest text-stone-300">0{index + 1}</span>
                  </div>
                  <h3 className="mt-5 font-bold text-stone-800">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-stone-500">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto mb-11 max-w-2xl text-center">
            <span className="text-xs font-bold tracking-[.15em] text-bms-primary">HOW IT WORKS</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-800 sm:text-4xl">Three Steps to Better Business Management</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { icon: ClipboardList, step: '01', title: 'Register Your Business', text: 'Set up your business profile, add employees and configure your products.' },
              { icon: HandCoins, step: '02', title: 'Manage Daily Operations', text: 'Record purchases, update stock, process sales and monitor expenses.' },
              { icon: TrendingUp, step: '03', title: 'Monitor Your Performance', text: 'View business statistics, analyze reports and make informed decisions.' },
            ].map(({ icon: Icon, step, title, text }) => (
              <article key={step} className="relative rounded-2xl border border-stone-200 p-6 sm:p-7">
                <span className="absolute right-6 top-6 text-xs font-bold tracking-widest text-bms-muted-gold">{step}</span>
                <span className="flex size-12 items-center justify-center rounded-xl bg-amber-100 text-bms-primary"><Icon size={22} /></span>
                <h3 className="mt-5 font-bold text-stone-800">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-gradient-to-br from-amber-50 to-bms-cream px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <span className="text-xs font-bold tracking-[.15em] text-bms-primary">WHY BUSINESSES TRUST BSSBMS</span>
              <h2 className="mt-3 max-w-lg text-3xl font-extrabold tracking-tight text-stone-800 sm:text-4xl">Business management made simple.</h2>
              <div className="mt-7 grid gap-x-4 gap-y-3 sm:grid-cols-2">
                {benefits.map((benefit) => <div key={benefit} className="flex items-center gap-2 text-sm text-stone-700"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700"><Check size={12} /></span>{benefit}</div>)}
              </div>
            </div>
            <div className="rounded-3xl border border-white bg-white/80 p-6 shadow-xl shadow-amber-900/5 sm:p-8">
              <span className="text-[10px] font-bold tracking-[.16em] text-stone-400">BUSINESS AT A GLANCE</span>
              <h3 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-stone-800">Clear numbers.<br />Confident decisions.</h3>
              <div className="mt-6 space-y-3">
                {[
                  [TrendingUp, 'Sales tracked', 'Review your daily performance'],
                  [Package, 'Stock monitored', 'Catch low stock before it runs out'],
                  [ReceiptText, 'Records organized', 'Keep transactions easy to find'],
                ].map(([Icon, title, detail]) => <div key={title} className="flex items-center gap-3 rounded-xl border border-stone-100 p-3"><span className="flex size-9 items-center justify-center rounded-lg bg-amber-100 text-bms-primary"><Icon size={18} /></span><span className="flex-1"><b className="block text-sm text-stone-700">{title}</b><small className="text-xs text-stone-400">{detail}</small></span><Check className="text-green-600" size={16} /></div>)}
              </div>
              <div className="mt-5 flex items-end gap-2 border-b border-stone-100 pb-1">{[28, 42, 34, 59, 48, 72, 54, 83, 68, 96, 77, 100].map((height, index) => <i key={index} style={{ height: `${height}px` }} className="flex-1 rounded-t bg-gradient-to-t from-amber-400 to-amber-100" />)}</div>
              <div className="mt-2 flex justify-between text-[9px] text-stone-400"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div>
            </div>
          </div>
        </section>

        <section className="px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 rounded-3xl border border-stone-100 bg-white p-7 shadow-sm sm:p-10 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:gap-16">
            <div>
              <span className="text-xs font-bold tracking-[.15em] text-bms-primary">OUR VISION</span>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-stone-800">Empowering businesses through technology and innovation.</h2>
            </div>
            <p className="text-sm leading-7 text-stone-600 sm:text-base">To become a trusted business management solution that empowers small and medium-sized businesses in Rwanda through technology and innovation.</p>
          </div>
        </section>

        <section className="relative overflow-hidden bg-stone-900 px-5 py-16 text-center text-white sm:px-8 sm:py-20">
          <span className="pointer-events-none absolute -left-16 -top-32 size-80 rounded-full border border-white/5" />
          <span className="pointer-events-none absolute -bottom-48 -right-10 size-96 rounded-full border border-white/5" />
          <div className="relative mx-auto max-w-2xl">
            <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[.15em] text-amber-300"><Sparkles size={13} /> BSSBMS – BUSINESS MANAGEMENT MADE SIMPLE</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Take the Next Step Towards Smarter Business Management.</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-stone-300">Spend less time managing paperwork and more time focusing on your business growth.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link to="/login" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-bms-primary px-6 text-sm font-bold text-white transition hover:bg-bms-primary-hover">Get Started Now <ArrowRight size={16} /></Link>
              <a href="#contact" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/30 px-6 text-sm font-semibold text-white transition hover:bg-white/10">Contact Our Team <ArrowRight size={16} /></a>
            </div>
          </div>
        </section>

        <section id="contact" className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 sm:py-24 md:grid-cols-2 md:items-center">
          <div>
            <span className="text-xs font-bold tracking-[.15em] text-bms-primary">CONTACT</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-stone-800 sm:text-4xl">Let&apos;s Talk About Your Business</h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-stone-600">We are ready to help you simplify your business management.</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-4 rounded-xl border border-stone-200 p-4">
              <span className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-bms-primary"><ReceiptText size={19} /></span><span className="flex-1"><small className="block text-[10px] font-bold tracking-widest text-stone-400">EMAIL</small><b className="mt-1 block text-sm text-stone-700">Your Business Email</b></span>
            </div>
            <div className="flex items-center gap-4 rounded-xl border border-stone-200 p-4">
              <span className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-bms-primary"><Users size={19} /></span><span className="flex-1"><small className="block text-[10px] font-bold tracking-widest text-stone-400">PHONE</small><b className="mt-1 block text-sm text-stone-700">Your Business Phone</b></span>
            </div>
            <div className="flex items-center gap-4 rounded-xl border border-stone-200 p-4">
              <span className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-bms-primary"><ShoppingCart size={19} /></span><span className="flex-1"><small className="block text-[10px] font-bold tracking-widest text-stone-400">LOCATION</small><b className="mt-1 block text-sm text-stone-700">Rwanda</b></span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 bg-stone-50 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <a href="#home" className="flex items-center gap-2 font-extrabold tracking-tight text-stone-800"><span className="flex size-9 items-center justify-center rounded-lg bg-bms-primary text-white"><Beer size={18} /></span>BSS<span className="-ml-2 text-bms-primary">BMS</span></a>
          <p className="text-xs text-stone-500">BSSBMS – Business Management Made Simple. Helping businesses stay organized, informed and prepared for growth.</p>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-stone-500">
            {navigation.map(([label, href]) => <a key={label} href={href} className="hover:text-bms-primary">{label}</a>)}
            <Link to="/login" className="hover:text-bms-primary">Sign In</Link>
          </nav>
        </div>
        <div className="mx-auto mt-6 max-w-6xl border-t border-stone-200 pt-5 text-center text-[11px] text-stone-400">© 2026 BSSBMS. All Rights Reserved.</div>
      </footer>
    </div>
  );
}

import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
export function Header() {
  return <header className="nav"><div className="wrap">
    <Link className="brand" href="/">🏠 Home Printing Service</Link>
    <nav aria-label="Main"><Link href="/#services">Services</Link><Link href="/#pricing">Pricing</Link><Link href="/#how">How it works</Link><Link href="/track">Track order</Link><Link href="/#contact">Contact</Link></nav>
    <ThemeToggle /></div></header>;
}
export function Footer() {
  return <footer><div className="wrap">© Home Printing Service · <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms</Link></div></footer>;
}
export function NotReady({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="wrap page"><span className="badge">Not implemented yet</span><h1>{title}</h1><p>{children}</p>
    <p><a className="btn green" href="https://wa.me/916301834150">Order on WhatsApp meanwhile</a></p></div>;
}

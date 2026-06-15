import Link from "next/link";

export function Footer({ className }: { className?: string }) {
  return (
    <footer className={className}>
      <div className="footer-top">
        <div className="footer-brand">
          Fantasy Hoops <span className="accent">Edge</span>
        </div>
        <div className="footer-links">
          <Link href="/dynasty-rankings">Dynasty Rankings</Link>
          <Link href="/draft-board">Rookies</Link>
          <Link href="/prediction-arena">Predictions Arena</Link>
        </div>
        <div className="footer-social">
          <a href="https://x.com/FantasyHoopEdge" target="_blank" rel="noopener noreferrer" title="X / Twitter">𝕏</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span className="footer-copy">© {new Date().getFullYear()} Fantasy Hoops Edge. All rights reserved.</span>
        <div className="footer-legal">
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/contact">Contact Us</Link>
        </div>
      </div>
    </footer>
  );
}

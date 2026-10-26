import type { Metadata } from "next"; import "./globals.css";
export const metadata: Metadata = { title: "Recall Lab — Study with intention", description: "Turn AI-made questions into a focused, interactive study session." };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hogar&Electro Dashboard | VTEX",
  description: "Dashboard de performance del seller Hogar&Electro. Monitoreo histórico de GMV, órdenes y performance consultando en vivo la API de VTEX.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

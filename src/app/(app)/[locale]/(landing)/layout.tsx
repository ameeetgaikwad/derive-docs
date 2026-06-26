export default async function LandingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <main data-landing>{children}</main>
}

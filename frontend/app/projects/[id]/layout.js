// ponytail: static export needs explicit params; pages under this are all client components,
// so generateStaticParams lives here (server layout). data is always client-fetched.
export function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

export default function ProjectLayout({ children }) {
  return children;
}

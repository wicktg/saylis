import type { Metadata } from "next";
import DocPageBody from "../_components/DocPageBody";
import { findDocPage, flatPages } from "../_lib/content";

export function generateStaticParams() {
  return flatPages().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const meta = findDocPage(params.slug);
  return { title: meta ? `${meta.title} - Saylis Docs` : "Saylis Docs" };
}

export default function DocSlugPage({ params }: { params: { slug: string } }) {
  return <DocPageBody slug={params.slug} />;
}

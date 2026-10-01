import DynamicCMSPage from "@/components/shop/dynamic-page-content";

export const dynamic = "force-dynamic";

export default function Page() {
  return <DynamicCMSPage params={{ slug: "faq" }} />;
}

import DynamicCMSPage from "@/components/shop/dynamic-page-content";
import ContactForm from "./contact-form";

export const dynamic = "force-dynamic";

export default function Page() {
  return <DynamicCMSPage params={{ slug: "contact" }}><ContactForm /></DynamicCMSPage>;
}

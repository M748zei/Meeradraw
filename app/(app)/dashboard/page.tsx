import { redirect } from "next/navigation";

// L'écran unique du studio vit sur /studio.
export default function DashboardPage() {
  redirect("/studio");
}

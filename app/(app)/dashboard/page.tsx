import { redirect } from "next/navigation";

// L'écran unique de Griot vit sur /griot ; le dashboard MeeraDraw n'existe plus.
export default function DashboardPage() {
  redirect("/griot");
}

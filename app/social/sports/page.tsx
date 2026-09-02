import { SportsSchedule } from "@/components/SportsSchedule";
import { getTexasHomeSchedules } from "@/lib/texasSports";

export const dynamic = "force-dynamic";

export default async function SportingEventsPage() {
  return <SportsSchedule teams={await getTexasHomeSchedules()} />;
}

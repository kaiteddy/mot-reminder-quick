import {
  ArrowRight,
  CalendarCheck2,
  Car,
  Check,
  FileText,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: RefreshCw,
    title: "Live MOT and tax refreshes",
    copy: "Refresh expiry dates from DVLA/DVSA data so your reminder list reflects the real vehicle status.",
  },
  {
    icon: MessageSquareText,
    title: "WhatsApp reminder sending",
    copy: "Send customer MOT reminders through Twilio WhatsApp templates, with delivery and reply status tracked back in the app.",
  },
  {
    icon: Search,
    title: "Customer and vehicle search",
    copy: "Find a customer by registration, name, phone, email, postcode, make, or model before booking the work.",
  },
  {
    icon: CalendarCheck2,
    title: "Booking follow-up tools",
    copy: "Mark MOTs as booked, review urgent follow-ups, and avoid chasing customers who already have a slot.",
  },
  {
    icon: FileText,
    title: "Garage admin in one place",
    copy: "Use customer records, service history, documents, estimates, job sheets, and account exports beside the reminder workflow.",
  },
  {
    icon: Wrench,
    title: "Workshop data links",
    copy: "Jump from a vehicle record into technical data, parts lookups, and the workshop job sheet when the customer books in.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "£49",
    note: "per garage, per month",
    description: "For independents that want a simple MOT recall machine.",
    perks: ["Up to 750 customer vehicles", "Manual reminder sending", "MOT and tax refreshes", "Email support"],
  },
  {
    name: "Growth",
    price: "£99",
    note: "per garage, per month",
    description: "For busy workshops that want reminders, replies, and admin connected.",
    perks: ["Up to 2,500 customer vehicles", "WhatsApp templates and status logs", "Booked MOT follow-up board", "Customer and vehicle import help"],
    highlighted: true,
  },
  {
    name: "Multi-Site",
    price: "£179",
    note: "per month",
    description: "For garage groups that need a shared process across teams.",
    perks: ["Multiple garage locations", "Priority onboarding", "Reporting and exports", "Custom reminder setup"],
  },
];

const stats = [
  { value: "07:00", label: "Daily MOT reminder cron" },
  { value: "DVLA", label: "Vehicle lookup ready" },
  { value: "WhatsApp", label: "Customer channel" },
];

export default function GarageSaasLanding() {
  return (
    <main className="min-h-screen bg-[#f7f8f4] text-slate-950">
      <section className="relative overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle_at_78%_18%,rgba(20,184,166,0.18),transparent_30%),linear-gradient(135deg,#0f172a_0%,#12343b_58%,#1f4d3a_100%)] text-white">
        <div className="container relative grid min-h-[720px] gap-10 py-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-12">
          <header className="absolute left-4 right-4 top-5 flex items-center justify-between sm:left-6 sm:right-6 lg:left-8 lg:right-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-slate-950">
                <Car className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">MOT Reminder Pro</p>
                <p className="mt-1 text-xs text-white/65">Built from ELI Motors' live garage workflow</p>
              </div>
            </div>
            <a href="#waitlist" className="hidden text-sm font-medium text-white/80 transition hover:text-white sm:block">
              Join waitlist
            </a>
          </header>

          <div className="pt-24 lg:pt-12">
            <Badge className="mb-6 border-white/20 bg-white/10 text-white hover:bg-white/10">
              UK garage SaaS
            </Badge>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-normal text-white sm:text-6xl lg:text-7xl">
              Never miss an MOT renewal customer again.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/78">
              Turn your customer database into a daily MOT recall engine: refresh expiry dates, send WhatsApp reminders, spot urgent follow-ups, and book work before the customer drifts elsewhere.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 bg-white px-6 text-slate-950 hover:bg-white/90">
                <a href="#waitlist">
                  Get early access <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-white/25 bg-white/5 px-6 text-white hover:bg-white/10 hover:text-white">
                <a href="#features">See features</a>
              </Button>
            </div>
            <div className="mt-12 grid max-w-2xl grid-cols-3 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-md border border-white/14 bg-white/8 p-4">
                  <p className="text-2xl font-semibold">{stat.value}</p>
                  <p className="mt-1 text-xs leading-5 text-white/64">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="pb-8 lg:pb-0">
            <div className="rounded-lg border border-white/12 bg-white/95 p-3 text-slate-950 shadow-2xl">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-sm font-semibold">MOT renewal pipeline</p>
                    <p className="text-xs text-slate-500">Today’s best customers to win back</p>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Live data</Badge>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    ["FKT350", "BMW 330i Sport Auto", "29 Jun 2026", "Ready to chase"],
                    ["LM61AEN", "Peugeot 207 Active", "11 Jun 2026", "Reminder sent"],
                    ["SN15TYX", "Ford B-Max Zetec Auto", "Expired", "Urgent follow-up"],
                    ["SG60FLM", "Honda Jazz i-VTEC EX", "05 Feb 2026", "Booked"],
                  ].map(([reg, car, expiry, status]) => (
                    <div key={reg} className="grid grid-cols-[92px_1fr] gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[92px_1fr_110px_128px] sm:items-center">
                      <div className="rounded bg-slate-950 px-3 py-2 text-center font-mono text-sm font-bold tracking-wide text-white">{reg}</div>
                      <div>
                        <p className="text-sm font-medium">{car}</p>
                        <p className="text-xs text-slate-500 sm:hidden">MOT {expiry}</p>
                      </div>
                      <p className="hidden text-sm text-slate-600 sm:block">{expiry}</p>
                      <p className="text-xs font-medium text-teal-700">{status}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-md bg-slate-950 p-4 text-white">
                  <p className="text-sm font-medium">WhatsApp preview</p>
                  <p className="mt-2 text-sm leading-6 text-white/72">
                    Hi Alex, your MOT is due soon. Reply BOOK and we will arrange a slot with the workshop.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-b border-slate-200 bg-white py-20">
        <div className="container">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">What garages get</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-normal text-slate-950">A real recall workflow, not another spreadsheet.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The product is based on a working Eli Motors system: customer and vehicle records, MOT expiry refreshes, WhatsApp reminders, follow-up boards, and garage admin in one web app.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article key={feature.title} className="rounded-lg border border-slate-200 bg-slate-50 p-6">
                <feature.icon className="h-6 w-6 text-teal-700" />
                <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{feature.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f7f8f4] py-20">
        <div className="container grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">Pricing</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-normal">Simple pricing for UK workshops.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              Start with the recall workflow, then grow into workshop records, reporting, and multi-site operations as the tool pays for itself.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={`rounded-lg border p-6 ${plan.highlighted ? "border-teal-700 bg-slate-950 text-white shadow-xl" : "border-slate-200 bg-white text-slate-950"}`}
              >
                {plan.highlighted && <Badge className="mb-4 bg-teal-400 text-slate-950 hover:bg-teal-400">Most popular</Badge>}
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <div className="mt-5 flex items-end gap-1">
                  <span className="text-4xl font-semibold">{plan.price}</span>
                  <span className={plan.highlighted ? "pb-1 text-sm text-white/60" : "pb-1 text-sm text-slate-500"}>/mo</span>
                </div>
                <p className={`mt-1 text-xs ${plan.highlighted ? "text-white/55" : "text-slate-500"}`}>{plan.note}</p>
                <p className={`mt-4 text-sm leading-6 ${plan.highlighted ? "text-white/70" : "text-slate-600"}`}>{plan.description}</p>
                <ul className="mt-6 space-y-3">
                  {plan.perks.map((perk) => (
                    <li key={perk} className="flex gap-2 text-sm">
                      <Check className={`mt-0.5 h-4 w-4 ${plan.highlighted ? "text-teal-300" : "text-teal-700"}`} />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="waitlist" className="border-t border-slate-200 bg-white py-20">
        <div className="container grid gap-10 lg:grid-cols-[1fr_0.85fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800">
              <Sparkles className="h-4 w-4" />
              Early access for independent UK garages
            </div>
            <h2 className="max-w-3xl text-4xl font-semibold tracking-normal">Bring back the MOT work already sitting in your customer list.</h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
              Register interest and we will follow up with onboarding details, data import options, and WhatsApp template setup.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["No backend wired yet", "Import-friendly", "Built for UK registrations"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-slate-700">
                  <ShieldCheck className="h-4 w-4 text-teal-700" />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <form className="rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                Garage name
                <Input placeholder="Your Garage Ltd" />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Work email
                <Input type="email" placeholder="owner@garage.co.uk" />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Vehicles in customer database
                <Input placeholder="About 1,200" />
              </label>
              <Button type="button" size="lg" className="mt-2 h-11">
                Request early access <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="text-xs leading-5 text-slate-500">
                Placeholder form only. Submitting will be connected when the commercial signup flow is ready.
              </p>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

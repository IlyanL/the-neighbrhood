"use client";

import { useState } from "react";
import { NbFig, NbFigs, NbPanel, NbSupportLayout } from "@/app/components/nb";

/* The handoff's `policy` screen: the measure on the left, a standing aside on
   the right. The prototype draws a working form — a subject line, a body and
   "Send to the team". There is no support inbox behind this app yet (see
   `/contact`, which says so), so drawing one would be the interface stating
   something untrue. The topic chips and the note they drive are the
   prototype's own behaviour and are kept; each note says where that kind of
   problem actually goes today. */

type Topic = { id: string; label: string; note: string; route: string };

const TOPICS: Topic[] = [
  {
    id: "money",
    label: "Money and a session",
    note: "A booked hour is only charged through the payment page for that booking, and nothing moves until the session does. If a charge looks wrong, open the session in Sessions — the booking carries its own payment state, and the tutor and the reviewer can both see it.",
    route: "Open the booking in Sessions",
  },
  {
    id: "safety",
    label: "Safety",
    note: "Anything that puts a student at risk is read first. Use the Report action on the listing, the post or the message so the reviewer opens it with the thing you are reporting already in front of them.",
    route: "Report the listing, post or message",
  },
  {
    id: "listing",
    label: "A listing or a post",
    note: "Every housing listing and every club event is reviewed before it appears, and every one of them carries a Report action. Reporting does not hide the post — only a reviewer can do that.",
    route: "Report it where it appears",
  },
  {
    id: "account",
    label: "Your account",
    note: "Your sign-in email and your password both live under Account and access. A password reset is a one-time link emailed to the address on the account, so it works even when you cannot sign in.",
    route: "Account and access, under your profile",
  },
  {
    id: "other",
    label: "Something else",
    note: "There is no public support address configured yet. This page will carry one as soon as there is an inbox behind it — until then nothing typed here would reach anyone, so the page does not pretend to collect it.",
    route: "Not yet configured",
  },
];

export function ContactView() {
  const [topicId, setTopicId] = useState(TOPICS[0].id);
  const topic = TOPICS.find((item) => item.id === topicId) ?? TOPICS[0];

  return (
    <div className="nb-pad">
      <NbSupportLayout
        aside={<>
          <NbPanel aside>
            <p className="nb-panel__title">If someone is at risk</p>
            <p className="nb-support__prose">This page is read during office hours. For anything urgent, use Western Special Constable Service on 519-661-3300, or 911.</p>
            <NbFigs card>
              <NbFig label="Emergency" value="911" />
              <NbFig label="Special Constable" value="519-661-3300" />
            </NbFigs>
          </NbPanel>
          <NbPanel aside>
            <p className="nb-panel__title">Who runs this</p>
            <NbFigs card>
              <NbFig label="Name" value="The Neighbrhood" />
              <NbFig label="Where" value="London, Ontario" />
              <NbFig label="Support address" value="Not configured yet" />
            </NbFigs>
          </NbPanel>
        </>}
      >
        <p className="nb-panel__title">What is this about?</p>
        <div className="nb-chips" style={{ marginTop: "14px" }}>
          {TOPICS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nb-chip${item.id === topicId ? " nb-chip--current" : ""}`}
              aria-pressed={item.id === topicId}
              onClick={() => setTopicId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="nb-support__note">{topic.note}</p>
        <NbFigs card>
          <NbFig label="Where it goes today" value={topic.route} />
        </NbFigs>
      </NbSupportLayout>
    </div>
  );
}

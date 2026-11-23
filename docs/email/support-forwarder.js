// Cloudflare Email Worker: forwards everything sent to support@theneighbrhood.ca to both
// founders. Cloudflare's routing rules only allow one destination per address, so this
// small script does the fan-out. Paste it into Cloudflare → Email Routing → Email Workers.
//
// allSettled, not all: forward() throws for an address that is not yet verified under
// "Destination addresses", and with Promise.all that one failure errored the whole run and
// Cloudflare rejected the message, so the verified recipient got nothing either.
const RECIPIENTS = ["owner@example.com", "cofounder@example.com"];

const worker = {
  async email(message) {
    const results = await Promise.allSettled(RECIPIENTS.map((to) => message.forward(to)));
    const delivered = results.filter((r) => r.status === "fulfilled").length;
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error(`Could not forward to ${RECIPIENTS[i]}:`, r.reason);
    });
    // Only reject the message if nobody got it, so the sender sees a bounce instead of silence.
    if (delivered === 0) message.setReject("Could not deliver to the support inbox.");
  },
};

export default worker;

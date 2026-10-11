const CARD = '4111 1111 1111 1111';
const SORT_CODE = '12-34-56';

export async function probe(impl) {
  const observed = new Set();

  const messages = impl.buildMessages({
    instructions: 'Answer from the ticket.',
    untrusted: [{ label: 'ticket', text: `customer says their card ${CARD} was declined, sort code ${SORT_CODE}` }],
    question: `is the card ${CARD} on file?`,
  });
  const sent = JSON.stringify(messages);

  if (sent.includes('4111')) observed.add('prevented.unredacted-context');

  // The residual, and this is the honest half of the claim. Four shapes are
  // matched. A UK sort code is not one of them and goes to the provider in
  // full, in both implementations. Anyone relying on this layer to keep an
  // identifier out of a third party's logs needs to add the pattern, or more
  // sensibly not put the identifier here.
  if (sent.includes(SORT_CODE)) observed.add('residual.redaction-misses-unlisted-formats');

  return observed;
}

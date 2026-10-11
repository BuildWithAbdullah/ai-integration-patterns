/** A model that always runs out of room at the same token limit. */
function truncatingModel(counter) {
  return async () => {
    counter.calls++;
    return '{"summary": "the response began correctly and then the budget ran ou';
  };
}

export async function probe(impl) {
  const observed = new Set();
  const counter = { calls: 0 };

  try {
    await impl.requestStructured({
      schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      ask: truncatingModel(counter),
      maxRepairs: 1,
    });
  } catch { /* both sides fail; what differs is how much they spent failing */ }

  if (counter.calls > 1) observed.add('prevented.repair-on-truncation');
  return observed;
}

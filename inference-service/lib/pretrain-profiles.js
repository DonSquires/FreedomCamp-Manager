function profileExamples(profile) {
  const selected = String(profile || 'nz-enforcement-v1').toLowerCase();

  if (selected === 'nz-enforcement-v1') {
    // Representative synthetic signal from vehicle recheck workflows.
    return [
      { similarity: 0.97, actual: true },
      { similarity: 0.95, actual: true },
      { similarity: 0.93, actual: true },
      { similarity: 0.91, actual: true },
      { similarity: 0.89, actual: true },
      { similarity: 0.87, actual: true },
      { similarity: 0.86, actual: true },
      { similarity: 0.84, actual: true },
      { similarity: 0.83, actual: true },
      { similarity: 0.82, actual: true },
      { similarity: 0.80, actual: false },
      { similarity: 0.79, actual: false },
      { similarity: 0.77, actual: false },
      { similarity: 0.75, actual: false },
      { similarity: 0.73, actual: false },
      { similarity: 0.71, actual: false },
      { similarity: 0.69, actual: false },
      { similarity: 0.67, actual: false },
      { similarity: 0.65, actual: false },
      { similarity: 0.63, actual: false },
    ];
  }

  return [
    { similarity: 0.95, actual: true },
    { similarity: 0.90, actual: true },
    { similarity: 0.85, actual: true },
    { similarity: 0.80, actual: false },
    { similarity: 0.75, actual: false },
    { similarity: 0.70, actual: false },
  ];
}

module.exports = { profileExamples };

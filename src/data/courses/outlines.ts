// Curriculum outlines — the named subtopics a unit is planned to cover, ahead
// of the questions existing for them.
//
// WHY THIS FILE EXISTS: the team authors outlines like this in /admin, and the
// Geometry, Algebra 2 and Precalculus outlines were destroyed when those course
// documents were overwritten with a bundle publish. Firestore had no recovery
// window, so these are RECONSTRUCTED in the style of the surviving Algebra 1
// outline (sentence case, 4-7 procedural steps per unit, taught order) — they
// are a faithful re-draft, not the original text. Algebra 1 is absent on
// purpose: its real outline survived in Firestore and must not be shadowed.
//
// Shipping them in the bundle means mergeBundledContent appends them to the
// cloud documents at load time, so the outlines come back with no admin write
// and no risk of overwriting anything. Editing them in /admin and saving makes
// the cloud copy authoritative from then on.

export const OUTLINES: Record<string, Record<string, readonly string[]>> = {
  geometry: {
    'foundations-and-logic': [
      'Points, lines & planes', 'Segments & angles', 'Conditional statements',
      'Inductive vs. deductive reasoning', 'Two-column proofs',
    ],
    transformations: [
      'Translations on the plane', 'Reflections across a line', 'Rotations about a point',
      'Dilations & scale factor', 'Symmetry', 'Composing transformations',
    ],
    congruence: [
      'Congruent figures', 'SSS & SAS', 'ASA & AAS', 'HL for right triangles',
      'CPCTC', 'Congruence proofs',
    ],
    similarity: [
      'Ratios & proportions', 'Similar polygons', 'Similar triangles (AA)',
      'Side-splitter theorem', 'Scale drawings',
    ],
    'right-triangles-and-trigonometry': [
      'Pythagorean theorem', 'Converse & Pythagorean triples', 'Special right triangles',
      'Sine, cosine & tangent', 'Solving right triangles', 'Angles of elevation & depression',
    ],
    quadrilaterals: [
      'Properties of parallelograms', 'Proving a parallelogram', 'Rectangles',
      'Rhombi & squares', 'Trapezoids & kites',
    ],
    circles: [
      'Parts of a circle', 'Central & inscribed angles', 'Arcs & arc length',
      'Chords', 'Tangents & secants', 'Sectors & segments', 'Equation of a circle',
    ],
    'coordinate-geometry': [
      'Distance formula', 'Midpoint formula', 'Slope & parallel lines',
      'Perpendicular lines', 'Coordinate proofs', 'Partitioning a segment',
    ],
    'area-and-volume': [
      'Area of polygons', 'Circumference & area of circles', 'Surface area of prisms & cylinders',
      'Surface area of pyramids & cones', 'Volume of prisms & cylinders',
      'Volume of pyramids, cones & spheres', 'Cross sections',
    ],
    probability: [
      'Sample spaces', 'Independent & dependent events', 'Conditional probability',
      'Two-way tables', 'Permutations & combinations',
    ],
  },

  'algebra-2': {
    'linear-and-absolute-value-functions': [
      'Parent functions', 'Solving absolute value equations', 'Absolute value inequalities',
      'Graphing absolute value', 'Piecewise functions', 'Transformations of functions',
    ],
    'systems-and-matrices': [
      'Systems in two variables', 'Systems in three variables', 'Systems of inequalities',
      'Determinants', 'Inverse matrices', 'Solving systems with matrices',
    ],
    'quadratic-functions': [
      'Standard, vertex & intercept form', 'Completing the square', 'Complex numbers',
      'Complex roots', 'Quadratic inequalities', 'Modeling with quadratics',
    ],
    polynomials: [
      'Polynomial operations', 'Long division', 'Synthetic division',
      'Rational root theorem', 'Graphing polynomials', 'End behavior',
    ],
    'rational-expressions-and-functions': [
      'Simplifying rational expressions', 'Multiplying & dividing', 'Adding & subtracting',
      'Complex fractions', 'Solving rational equations', 'Graphing rational functions',
    ],
    'radical-functions': [
      'nth roots', 'Rational exponents', 'Operations with radicals',
      'Graphing radical functions', 'Inverse functions',
    ],
    'exponential-and-logarithmic-functions': [
      'Exponential growth & decay', 'The number e', 'Logarithms & their graphs',
      'Properties of logarithms', 'Solving logarithmic equations', 'Modeling with exponentials',
    ],
    'sequences-and-series': [
      'Arithmetic series', 'Geometric series', 'Infinite geometric series',
      'Recursive formulas', 'Sigma notation',
    ],
    'probability-and-statistics': [
      'Permutations & combinations', 'Probability of compound events', 'Conditional probability',
      'Binomial distributions', 'Normal distributions', 'Samples & surveys', 'Margin of error',
    ],
    'trigonometric-functions': [
      'Angles & the unit circle', 'Radian measure', 'Right triangle trig',
      'Trig functions of any angle', 'Graphing sine & cosine',
      'Amplitude, period & phase shift', 'Inverse trig functions',
    ],
  },

  precalculus: {
    'functions-and-their-graphs': [
      'Function notation & domain', 'Graphs & symmetry', 'Transformations of graphs',
      'Combining functions', 'Composite functions', 'Piecewise & step functions',
    ],
    'polynomial-and-rational-functions': [
      'Quadratic functions', 'Higher-degree polynomials', 'Real zeros', 'Complex zeros',
      'Rational functions', 'Polynomial & rational inequalities',
    ],
    'exponential-and-logarithmic-functions': [
      'Exponential functions', 'Logarithmic functions', 'Properties of logarithms',
      'Exponential & logarithmic equations', 'Modeling growth & decay', 'Logistic models',
    ],
    'trigonometric-functions': [
      'Angles & radian measure', 'The unit circle', 'Right triangle trig',
      'Trig functions of any angle', 'Graphs of sine & cosine',
      'Graphs of other trig functions', 'Inverse trig functions',
    ],
    'trigonometric-identities-and-equations': [
      'Fundamental identities', 'Verifying identities', 'Sum & difference formulas',
      'Double & half-angle formulas', 'Law of sines', 'Law of cosines',
    ],
    'systems-and-matrices': [
      'Systems of equations', 'Systems of inequalities', 'Matrix operations',
      'Cramer’s rule', 'Partial fractions',
    ],
    'sequences-series-and-sigma-notation': [
      'Sequences & recursion', 'Arithmetic series', 'Geometric series',
      'Infinite series', 'Mathematical induction', 'Binomial theorem',
    ],
    vectors: [
      'Vectors in the plane', 'Component form', 'Vector operations',
      'Unit vectors', 'Angle between vectors', 'Vector applications',
    ],
    'parametric-and-polar-equations': [
      'Parametric equations', 'Graphing parametric curves', 'Eliminating the parameter',
      'Polar equations & graphs', 'Complex numbers in polar form', 'De Moivre’s theorem',
    ],
    'limits-and-intro-to-calculus': [
      'Introduction to limits', 'Limits graphically & numerically', 'Limit laws',
      'One-sided limits', 'Limits at infinity', 'Tangent lines & rates of change',
    ],
  },
}

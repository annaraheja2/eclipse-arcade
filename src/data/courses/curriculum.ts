// THE CURRICULUM — the team's canonical unit/subtopic outline for all four
// courses, supplied by Harish. This is the structure the courses take; the
// question sets in the sibling files are placed INTO it (see PLACEMENT below),
// so content follows the curriculum rather than the other way round.
//
// Every subtopic carries the one-line description from the outline. A subtopic
// with no questions yet still appears in the pickers (disabled) so the plan is
// visible before the content exists.
//
// Unit ids reuse the previous ones wherever a unit corresponds, so the cloud
// copies keep their existing content attached instead of orphaning it.

export interface OutlineTopic { name: string; description: string }
export interface OutlineUnit { id: string; name: string; description: string; topics: OutlineTopic[] }

const t = (name: string, description: string): OutlineTopic => ({ name, description })

export const CURRICULUM: Record<string, readonly OutlineUnit[]> = {
  'algebra-1': [
    { id: 'foundations-of-algebra', name: 'Foundations of Algebra', description: 'expressions, operations, properties', topics: [
      t('Variables & Expressions', 'Variables, algebraic expressions, terms, coefficients, constants, like terms.'),
      t('Order of Operations & Absolute Value', 'PEMDAS, nested grouping, absolute value properties.'),
      t('Properties of Real Numbers', 'Commutative, associative, distributive, identity, inverse.'),
      t('Evaluating Expressions', 'Substitution, simplifying numeric and algebraic expressions.'),
      t('Translating Words to Expressions', 'Key phrases, modeling real situations.'),
    ]},
    { id: 'solving-linear-equations', name: 'Solving Linear Equations & Inequalities', description: 'equations, inequalities, formulas', topics: [
      t('One-Step & Two-Step Equations', 'Addition/subtraction, multiplication/division, checking solutions.'),
      t('Multi-Step Equations', 'Distributive property, combining like terms, variable on both sides.'),
      t('Literal Equations & Formulas', 'Solving for a specified variable, rearranging formulas.'),
      t('Absolute Value Equations & Inequalities', 'Split-case method, graphing solutions.'),
      t('Linear Inequalities', 'Solving, compound inequalities, interval notation, graphing on a number line.'),
      t('Systems of Linear Equations (Intro)', 'Substitution, elimination (basic).'),
    ]},
    { id: 'functions-and-relations', name: 'Functions and Relations', description: 'notation, linear functions, modeling', topics: [
      t('Relations vs Functions', 'Mapping, vertical line test.'),
      t('Function Notation & Evaluation', 'f(x) notation, domain and range.'),
      t('Linear Functions', 'Slope-intercept, point-slope, standard form.'),
      t('Modeling with Functions', 'Interpreting slope and intercept in context.'),
      t('Transformations of Functions (Intro)', 'Vertical/horizontal shifts, reflections, stretches.'),
    ]},
    { id: 'systems-of-equations', name: 'Linear Systems and Inequalities', description: 'systems, applications, programming', topics: [
      t('Solving Systems Algebraically', 'Substitution, elimination, solving for two variables.'),
      t('Solving Systems Graphically', 'Intersection interpretation, parallel/no solution, coincident/infinite solutions.'),
      t('Applications of Systems', 'Mixture, rate, cost problems.'),
      t('Linear Programming (Intro)', 'Feasible region, objective function, corner-point method.'),
      t('Systems of Inequalities', 'Graphing solution regions, real-world constraints.'),
    ]},
    { id: 'exponents-and-exponential-functions', name: 'Exponents and Exponential Functions', description: 'exponent rules, growth and decay', topics: [
      t('Integer Exponents Rules', 'Product, quotient, power of a power, zero exponent.'),
      t('Scientific Notation', 'Converting, operations with scientific notation.'),
      t('Negative & Rational Exponents (Intro)', 'Meaning of fractional exponents, radicals connection.'),
      t('Exponential Growth & Decay (Intro)', 'Modeling, doubling/half-life contexts.'),
    ]},
    { id: 'polynomials', name: 'Polynomials and Factoring', description: 'operations and factoring techniques', topics: [
      t('Polynomial Vocabulary', 'Degree, leading coefficient, monomial/binomial/trinomial.'),
      t('Adding/Subtracting Polynomials', 'Combining like terms.'),
      t('Multiplying Polynomials', 'Distributive property, FOIL, special products and perfect squares.'),
      t('Factoring Techniques', 'GCF, factoring trinomials, factoring by grouping, difference of squares.'),
      t('Solving Quadratics by Factoring (Intro)', 'Zero-product property.'),
    ]},
    { id: 'quadratic-functions', name: 'Quadratic Functions (Intro)', description: 'graphing, solving, applications', topics: [
      t('Quadratic Vocabulary', 'Vertex, axis of symmetry, roots, y-intercept.'),
      t('Graphing Quadratics', 'Vertex form, intercept form, plotting key points.'),
      t('Solving Quadratics', 'Factoring, square roots (perfect square), completing the square (intro).'),
      t('Applications', 'Projectile motion, area problems.'),
    ]},
    { id: 'rational-expressions', name: 'Rational Expressions & Equations (Intro)', description: 'simplifying, operating, solving', topics: [
      t('Simplifying Rational Expressions', 'Factoring numerator/denominator, canceling factors.'),
      t('Multiplying & Dividing Rational Expressions', 'Invert-and-multiply, domain restrictions.'),
      t('Adding & Subtracting Rational Expressions', 'Common denominators, LCD.'),
      t('Solving Rational Equations', 'Extraneous solutions, checking domain.'),
    ]},
    { id: 'data-and-statistics', name: 'Data, Probability, and Statistics (Intro)', description: 'describing, representing, modeling data', topics: [
      t('Descriptive Statistics', 'Mean, median, mode, range, interquartile range.'),
      t('Representing Data', 'Histograms, box plots, scatter plots.'),
      t('Linear Regression & Correlation (Intro)', 'Line of best fit, interpreting correlation.'),
      t('Probability Basics', 'Simple probability, compound events (independent/dependent basics).'),
    ]},
  ],

  geometry: [
    { id: 'foundations-and-logic', name: 'Basics of Geometry & Reasoning', description: 'notation, constructions, proof', topics: [
      t('Points, Lines, Planes', 'Notation, collinear, coplanar.'),
      t('Segments & Rays', 'Midpoint, segment addition.'),
      t('Angles & Angle Pairs', 'Adjacent, vertical, complementary, supplementary.'),
      t('Basic Constructions', 'Compass and straightedge basics, perpendicular bisector, angle bisector.'),
      t('Logic & Proofs', 'Conditional statements, converses, biconditionals, two-column proofs.'),
    ]},
    { id: 'parallel-lines', name: 'Parallel Lines & Angle Relationships', description: 'transversals and coordinate criteria', topics: [
      t('Parallel Line Theorems', 'Corresponding, alternate interior/exterior, same-side interior.'),
      t('Transversals', 'Angle relationships and proofs.'),
      t('Slopes & Parallel/Perpendicular Lines', 'Coordinate criteria, proofs.'),
    ]},
    { id: 'congruence', name: 'Triangles — Classification & Congruence', description: 'triangle types and congruence proofs', topics: [
      t('Triangle Types', 'By sides and angles.'),
      t('Triangle Inequality & Side-Angle Relationships', 'Longest side vs largest angle.'),
      t('Congruence Criteria', 'SSS, SAS, ASA, AAS, HL.'),
      t('CPCTC', 'Using congruence to prove other facts.'),
      t('Isosceles & Equilateral Properties', 'Base angles, perpendicular bisectors.'),
    ]},
    { id: 'similarity', name: 'Triangle Similarity & Right Triangle Trigonometry', description: 'similarity, ratios, the Pythagorean theorem', topics: [
      t('Similarity Criteria', 'AA, SSS~, SAS~.'),
      t('Proportional Reasoning', 'Corresponding sides, scale factor.'),
      t('Right Triangle Ratios', 'Sine, cosine, tangent (basic), special right triangles.'),
      t('Pythagorean Theorem & Converse', 'Distance applications, Pythagorean triples.'),
      t('Geometric Mean & Altitude Theorem', 'Segment relationships in right triangles.'),
    ]},
    { id: 'quadrilaterals', name: 'Quadrilaterals & Polygons', description: 'classification, properties, regular polygons', topics: [
      t('Quadrilateral Classification', 'Parallelogram, rectangle, rhombus, square, kite, trapezoid.'),
      t('Properties of Parallelograms', 'Opposite sides/angles, diagonals bisect.'),
      t('Special Quadrilaterals', 'Rectangle, rhombus and square properties.'),
      t('Trapezoid Theorems', 'Midsegment, isosceles trapezoid properties.'),
      t('Regular Polygons', 'Interior/exterior angle measures, central angles, apothem.'),
    ]},
    { id: 'coordinate-geometry', name: 'Coordinate Geometry', description: 'distance, slope, coordinate proof', topics: [
      t('Distance & Midpoint Formulas', 'Derived from the Pythagorean theorem.'),
      t('Slope & Equation of a Line', 'Point-slope, slope-intercept, standard form.'),
      t('Using Coordinates to Prove', 'Congruence, parallelism, perpendicularity, polygon classification.'),
      t('Circles in Coordinate Plane', 'Standard equation, center-radius form.'),
    ]},
    { id: 'circles', name: 'Circles', description: 'angles, chords, arcs and sectors', topics: [
      t('Circle Vocabulary', 'Radius, diameter, chord, tangent, secant, arc.'),
      t('Arc Measure & Central/Inscribed Angles', 'Arc-angle relationships.'),
      t('Chord & Tangent Theorems', 'Congruent chords, tangent-radius perpendicularity.'),
      t('Inscribed Polygons & Angle Measures', 'Cyclic quadrilaterals.'),
      t('Arc Length & Sector Area', 'Radian-degree conversions.'),
    ]},
    { id: 'area-and-volume', name: 'Area, Surface Area & Volume', description: '2D area through 3D solids', topics: [
      t('Area of Polygons', 'Triangles, parallelograms, trapezoids, kites.'),
      t('Area of Regular Polygons', 'Apothem method.'),
      t('Circle Area & Circumference', 'Area and circumference formulas.'),
      t('Surface Area of Solids', 'Prisms, cylinders, pyramids, cones, spheres.'),
      t('Volume of Solids', 'Prisms, cylinders, pyramids, cones, spheres.'),
      t('Composite Figures & Cross Sections', 'Decomposing shapes, slicing solids.'),
    ]},
    { id: 'transformations', name: 'Transformations & Symmetry', description: 'rigid motions, dilations, symmetry', topics: [
      t('Rigid Motions', 'Translations, rotations, reflections.'),
      t('Dilations & Similarity', 'Scale factor, center of dilation.'),
      t('Symmetry', 'Line symmetry, rotational symmetry.'),
      t('Composition of Transformations', 'Combining motions, coordinate rules.'),
    ]},
    { id: 'probability', name: 'Probability (Geometric)', description: 'sample spaces and geometric models', topics: [
      t('Basic Probability Review', 'Outcomes, sample space.'),
      t('Geometric Probability', 'Length/area models.'),
      t('Compound Geometric Probability', 'Multiple regions, conditional geometric setups.'),
    ]},
  ],

  'algebra-2': [
    { id: 'advanced-equations', name: 'Advanced Equations & Inequalities', description: 'quadratic through radical equations', topics: [
      t('Linear & Absolute Value Revisited', 'Complex compound inequalities.'),
      t('Quadratic Equations', 'Completing the square, quadratic formula, discriminant analysis.'),
      t('Polynomial Equations', 'Rational root theorem, multiplicity of roots.'),
      t('Rational Equations & Inequalities', 'Asymptotes, domain, sign analysis.'),
      t('Radical Equations', 'Isolating radicals, extraneous solutions.'),
    ]},
    { id: 'complex-numbers', name: 'Complex Numbers', description: 'arithmetic, conjugates, polar form', topics: [
      t('Imaginary Unit & Arithmetic', 'Powers of i, addition and subtraction.'),
      t('Complex Conjugates & Division', 'Rationalizing denominators.'),
      t('Polar Form & De Moivre (Intro)', 'Magnitude and argument basics.'),
    ]},
    { id: 'polynomials', name: 'Polynomial Functions', description: 'behaviour, graphing, division', topics: [
      t('End Behavior & Leading Coefficient', 'Degree effects.'),
      t('Graphing Polynomials', 'Zeros, multiplicity, turning points.'),
      t('Factoring Higher-Degree Polynomials', 'Synthetic division, remainder theorem.'),
      t('Fundamental Theorem of Algebra (Intro)', 'Number of roots (complex).'),
    ]},
    { id: 'rational-expressions-and-functions', name: 'Rational Functions', description: 'asymptotes, graphs, applications', topics: [
      t('Asymptotes', 'Vertical, horizontal, oblique.'),
      t('Graphing Rational Functions', 'Intercepts, holes, behaviour near asymptotes.'),
      t('Applications', 'Rates, inverse variation models.'),
    ]},
    { id: 'exponential-and-logarithmic-functions', name: 'Exponential & Logarithmic Functions', description: 'logs, equations, modeling', topics: [
      t('Exponential Functions', 'Growth/decay models, compound interest.'),
      t('Logarithms', 'Definition, properties, change of base.'),
      t('Solving Exponential/Log Equations', 'Using logs, domain considerations.'),
      t('Applications', 'pH, Richter scale, half-life, doubling time.'),
    ]},
    { id: 'sequences-and-series', name: 'Sequences & Series', description: 'arithmetic, geometric, sigma notation', topics: [
      t('Arithmetic Sequences & Sums', 'Common difference, partial sums.'),
      t('Geometric Sequences & Sums', 'Common ratio, finite/infinite series.'),
      t('Sigma Notation & Summation Techniques', 'Compact representation.'),
      t('Recursive Definitions', 'Iteration and closed forms.'),
    ]},
    { id: 'conic-sections', name: 'Conic Sections', description: 'parabolas, circles, ellipses, hyperbolas', topics: [
      t('Parabolas', 'Focus/directrix, vertex form, reflective property.'),
      t('Circles', 'Standard equation review.'),
      t('Ellipses & Hyperbolas', 'Standard forms, foci, asymptotes for hyperbola.'),
      t('Graphing & Applications', 'Orbital paths, optics.'),
    ]},
    { id: 'trigonometric-functions', name: 'Trigonometry', description: 'unit circle through the laws', topics: [
      t('Unit Circle & Radian Measure', 'Coordinates, reference angles.'),
      t('Trigonometric Functions', 'Graphs, amplitude, period, phase shift.'),
      t('Trigonometric Identities', 'Pythagorean, reciprocal, quotient, cofunction.'),
      t('Solving Trig Equations', 'Algebraic and graphical methods.'),
      t('Law of Sines & Cosines', 'Non-right triangle solving, ambiguous case.'),
    ]},
    { id: 'systems-and-matrices', name: 'Matrices & Determinants (Intro)', description: 'operations, inverses, systems', topics: [
      t('Matrix Operations', 'Addition, scalar multiplication, multiplication.'),
      t('Determinants & Inverses', '2×2 determinant, inverse via adjugate.'),
      t('Systems via Matrices', 'Solving linear systems, Cramer’s rule (intro).'),
    ]},
    { id: 'probability-and-statistics', name: 'Probability & Statistics (Advanced Topics)', description: 'counting, distributions, regression', topics: [
      t('Counting Principles', 'Permutations, combinations.'),
      t('Binomial Probability', 'Binomial theorem basics, distribution.'),
      t('Normal Distribution (Intro)', 'z-scores, empirical rule.'),
      t('Regression & Correlation (Advanced)', 'Interpreting fit, residuals.'),
    ]},
  ],

  precalculus: [
    { id: 'functions-and-their-graphs', name: 'Functions Deep Dive', description: 'families, inverses, composition', topics: [
      t('Function Families', 'Polynomial, rational, exponential, logarithmic, trigonometric.'),
      t('Inverse Functions', 'Existence, finding inverses, domain/range swaps.'),
      t('Composition of Functions', 'Composite notation, domain considerations.'),
      t('Transformations & Modeling', 'Advanced shifts, stretches, reflections.'),
    ]},
    { id: 'polynomial-and-rational-functions', name: 'Polynomial & Rational Function Analysis', description: 'behaviour, graphs, decomposition', topics: [
      t('Advanced Polynomial Behavior', 'Multiplicity, end behavior, complex roots.'),
      t('Graphing Rational Functions', 'Slant asymptotes, detailed sign charts.'),
      t('Partial Fraction Decomposition (Intro)', 'Preparing for integration.'),
    ]},
    { id: 'exponential-and-logarithmic-functions', name: 'Exponential & Logarithmic Functions (Advanced)', description: 'continuous growth and log scales', topics: [
      t('Continuous Growth & e', 'Natural exponential, continuous compounding.'),
      t('Logarithmic Scales & Applications', 'Modeling, solving complex equations.'),
      t('Inverse Relationships', 'Domain/range interplay, transformations.'),
    ]},
    { id: 'trigonometric-functions', name: 'Trigonometry (Advanced)', description: 'identities, equations, polar and parametric', topics: [
      t('Unit Circle Mastery', 'Exact values, symmetry, reference angles.'),
      t('Trigonometric Identities & Proofs', 'Sum/difference, double-angle, half-angle.'),
      t('Trigonometric Equations & Solutions', 'General solutions, periodicity.'),
    ]},
    { id: 'parametric-and-polar-equations', name: 'Parametric & Polar Equations', description: 'polar coordinates and parametric motion', topics: [
      t('Polar Coordinates & Graphs', 'Converting between polar and rectangular.'),
      t('Parametric Equations', 'Motion modeling, eliminating the parameter.'),
    ]},
    { id: 'conics', name: 'Analytic Geometry & Conics (Advanced)', description: 'derivations, rotation, applications', topics: [
      t('Conic Derivations', 'Deriving standard forms from definitions.'),
      t('Rotation of Axes (Intro)', 'Removing the xy term, classifying conics.'),
      t('Applications', 'Reflective properties, optimization.'),
    ]},
    { id: 'vectors', name: 'Vectors & Complex Numbers (Advanced)', description: 'vector algebra and polar complex numbers', topics: [
      t('Vectors in Plane', 'Magnitude, direction, components, dot product.'),
      t('Vector Operations', 'Addition, scalar multiplication, projections.'),
      t('Complex Numbers in Polar Form', 'Multiplication/division via modulus and argument.'),
      t('De Moivre’s Theorem & Roots of Unity', 'Powers and roots.'),
    ]},
    { id: 'limits-and-intro-to-calculus', name: 'Limits & Introductory Calculus Concepts', description: 'limits, continuity, rates of change', topics: [
      t('Concept of a Limit', 'Intuitive approach, one-sided limits.'),
      t('Continuity', 'Removable, jump, infinite discontinuities.'),
      t('Rate of Change & Slope of Tangent (Intro)', 'Precursor to the derivative.'),
      t('End Behavior & Limits at Infinity', 'Horizontal asymptotes.'),
    ]},
    { id: 'sequences-series-and-sigma-notation', name: 'Sequences, Series & Binomial Theorem', description: 'convergence, series, expansion', topics: [
      t('Advanced Sequences', 'Convergence/divergence intuition.'),
      t('Series & Tests (Intro)', 'Geometric series, partial sums.'),
      t('Binomial Theorem', 'Expansion, binomial coefficients, Pascal’s triangle.'),
    ]},
    { id: 'systems-and-matrices', name: 'Matrices, Determinants & Systems (Advanced)', description: 'matrix algebra and applications', topics: [
      t('Matrix Algebra', 'Higher-dimension operations, inverses.'),
      t('Eigenconcepts (Intro)', 'Eigenvalues/eigenvectors intuition (optional).'),
      t('Applications to Systems', 'Modeling multi-variable systems.'),
    ]},
    { id: 'modeling-and-applications', name: 'Modeling & Applications', description: 'translating, optimizing, preparing for calculus', topics: [
      t('Mathematical Modeling', 'Translating real problems into functions.'),
      t('Optimization Problems', 'Using algebraic/trigonometric models.'),
      t('Periodic Phenomena', 'Modeling with trig functions, phase shifts.'),
      t('Preparation for Calculus', 'Synthesis of algebra, trig, and analytic geometry.'),
    ]},
  ],
}

/**
 * Where each existing question set lives in the new structure: subunit id ->
 * curriculum unit id. Every authored subunit MUST appear here or its questions
 * would be orphaned by the restructure — courses.test.ts enforces that.
 */
/**
 * Where each authored question set lands: subunit id -> `unitId` to sit in that
 * unit under its own name, or `unitId#Topic Name` to be poured INTO that
 * curriculum subtopic (keeping the curriculum's name and description). Several
 * sets may share one topic; their questions concatenate.
 *
 * Every authored subunit MUST appear here or the restructure would orphan its
 * questions — courses.test.ts proves none is lost.
 */
export const PLACEMENT: Record<string, Record<string, string>> = {
  'algebra-1': {
    terms: 'foundations-of-algebra#Variables & Expressions',
    'one-step': 'solving-linear-equations#One-Step & Two-Step Equations',
    'two-step': 'solving-linear-equations#One-Step & Two-Step Equations',
    'multi-step': 'solving-linear-equations#Multi-Step Equations',
    'one-step-inequalities': 'solving-linear-equations#Linear Inequalities',
    'multi-step-inequalities': 'solving-linear-equations#Linear Inequalities',
    'function-notation': 'functions-and-relations#Function Notation & Evaluation',
    'domain-and-range': 'functions-and-relations#Function Notation & Evaluation',
    plot: 'functions-and-relations#Linear Functions',
    intercepts: 'functions-and-relations#Linear Functions',
    substitution: 'systems-of-equations#Solving Systems Algebraically',
    elimination: 'systems-of-equations#Solving Systems Algebraically',
    'exponent-rules': 'exponents-and-exponential-functions#Integer Exponents Rules',
    'exponential-growth': 'exponents-and-exponential-functions#Exponential Growth & Decay (Intro)',
    'degree-and-coefficients': 'polynomials#Polynomial Vocabulary',
    'evaluating-polynomials': 'polynomials', // evaluating, not adding/subtracting — own subtopic
    'factoring-trinomials': 'polynomials#Factoring Techniques',
    'special-products': 'polynomials#Factoring Techniques',
    vertex: 'quadratic-functions#Graphing Quadratics',
    'quadratic-formula': 'quadratic-functions#Solving Quadratics',
    'completing-the-square': 'quadratic-functions#Solving Quadratics',
    'mean-median-mode': 'data-and-statistics#Descriptive Statistics',
    'spread-and-outliers': 'data-and-statistics#Descriptive Statistics',
  },
  geometry: {
    'points-lines-angles': 'foundations-and-logic#Angles & Angle Pairs',
    'logic-and-proof': 'foundations-and-logic#Logic & Proofs',
    'congruence-criteria': 'congruence#Congruence Criteria',
    'corresponding-parts': 'congruence', // triangle angle relationships, not CPCTC — own subtopic
    'scale-factor': 'similarity#Proportional Reasoning',
    'proportional-sides': 'similarity#Proportional Reasoning',
    'pythagorean-theorem': 'similarity#Pythagorean Theorem & Converse',
    'soh-cah-toa': 'similarity#Right Triangle Ratios',
    parallelograms: 'quadrilaterals#Properties of Parallelograms',
    'rectangles-rhombi-trapezoids': 'quadrilaterals#Special Quadrilaterals',
    'distance-and-midpoint': 'coordinate-geometry#Distance & Midpoint Formulas',
    'slope-and-lines': 'coordinate-geometry#Slope & Equation of a Line',
    'arcs-and-central-angles': 'circles#Arc Measure & Central/Inscribed Angles',
    'chords-tangents-sectors': 'circles#Chord & Tangent Theorems',
    'area-and-perimeter': 'area-and-volume#Area of Polygons',
    'surface-area-and-volume': 'area-and-volume', // covers both surface area and volume — own subtopic
    translations: 'transformations#Rigid Motions',
    'reflections-rotations': 'transformations#Rigid Motions',
    'basic-probability': 'probability#Basic Probability Review',
    'geometric-probability': 'probability#Geometric Probability',
  },
  'algebra-2': {
    'absolute-value-equations': 'advanced-equations#Linear & Absolute Value Revisited',
    'absolute-value-transformations': 'advanced-equations', // graph set — cannot merge into a slider topic
    'vertex-and-axis': 'advanced-equations', // graph set — cannot merge into a slider topic
    discriminant: 'advanced-equations#Quadratic Equations',
    'simplifying-radicals': 'advanced-equations#Radical Equations',
    'radical-equations': 'advanced-equations#Radical Equations',
    'remainder-theorem': 'polynomials#Factoring Higher-Degree Polynomials',
    'factor-theorem': 'polynomials#Factoring Higher-Degree Polynomials',
    'excluded-values': 'rational-expressions-and-functions#Graphing Rational Functions',
    asymptotes: 'rational-expressions-and-functions#Asymptotes',
    'logarithm-basics': 'exponential-and-logarithmic-functions#Logarithms',
    'exponential-equations': 'exponential-and-logarithmic-functions#Solving Exponential/Log Equations',
    'arithmetic-sequences': 'sequences-and-series#Arithmetic Sequences & Sums',
    'geometric-sequences': 'sequences-and-series#Geometric Sequences & Sums',
    'degrees-and-radians': 'trigonometric-functions#Unit Circle & Radian Measure',
    'unit-circle-values': 'trigonometric-functions#Unit Circle & Radian Measure',
    'solving-systems': 'systems-and-matrices#Systems via Matrices',
    'matrix-operations': 'systems-and-matrices#Matrix Operations',
    'counting-and-probability': 'probability-and-statistics#Counting Principles',
    'statistics-and-distributions': 'probability-and-statistics', // mixed stats, not only the normal distribution
  },
  precalculus: {
    'evaluating-and-composing': 'functions-and-their-graphs#Composition of Functions',
    'inverse-functions': 'functions-and-their-graphs#Inverse Functions',
    'degree-and-end-behavior': 'polynomial-and-rational-functions#Advanced Polynomial Behavior',
    'asymptotes-and-holes': 'polynomial-and-rational-functions#Graphing Rational Functions',
    'log-laws': 'exponential-and-logarithmic-functions', // log laws are not log scales — own subtopic
    'growth-decay-half-life': 'exponential-and-logarithmic-functions#Continuous Growth & e',
    'unit-circle-angles': 'trigonometric-functions#Unit Circle Mastery',
    'amplitude-and-period': 'trigonometric-functions', // no graphs topic in the outline — own subtopic
    'pythagorean-identities': 'trigonometric-functions#Trigonometric Identities & Proofs',
    'solving-trig-equations': 'trigonometric-functions#Trigonometric Equations & Solutions',
    'polar-coordinates': 'parametric-and-polar-equations#Polar Coordinates & Graphs',
    'parametric-curves': 'parametric-and-polar-equations#Parametric Equations',
    'components-and-magnitude': 'vectors#Vectors in Plane',
    'dot-product': 'vectors#Vector Operations',
    'evaluating-limits': 'limits-and-intro-to-calculus#Concept of a Limit',
    'continuity-and-derivatives': 'limits-and-intro-to-calculus#Rate of Change & Slope of Tangent (Intro)',
    'sigma-notation': 'sequences-series-and-sigma-notation', // notation, not a series test — own subtopic
    'partial-sums': 'sequences-series-and-sigma-notation#Series & Tests (Intro)',
    'determinants-and-inverses': 'systems-and-matrices#Matrix Algebra',
    'solving-with-matrices': 'systems-and-matrices#Applications to Systems',
  },
}

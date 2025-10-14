export default function ({ assigns }) {
  return '<h1>' + (assigns?.title || '') + '</h1>';
}


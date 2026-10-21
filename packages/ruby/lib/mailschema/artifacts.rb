# frozen_string_literal: true

# MAP 0.3's identifiers, limits and schema validation.
module Mailschema
  PROFILE = "https://mailschema.org/profiles/map/0.3"
  CONTEXT = "https://mailschema.org/contexts/map-0.3.jsonld"
  # The Content-Type of the MIME part that carries a description.
  DESCRIPTION_MEDIA_TYPE = %(application/ld+json; profile="#{PROFILE}").freeze
  DESCRIPTION_MAX_BYTES = 65_536
  CONTRACT_MAX_BYTES = 262_144
  # The namespace of the initial effect vocabulary.
  EFFECTS = "https://mailschema.org/effects/"
  # The formats MAP schemas may assert. Every implementation checks exactly these.
  FORMATS = %w[date date-time email uri].freeze

  # JSON Schema 2020-12 as MAP reads it: the listed formats asserted and no other, ECMA-262
  # regular expressions, so ^ and $ anchor the whole value, and references resolved only
  # within the schema, never over the network.
  module Schemas
    ARTIFACTS = File.expand_path("../../artifacts", __dir__)
    FORMAT_CHECKS = Formats.checks.freeze

    module_function

    def compile(schema)
      JSONSchemer.schema(
        schema,
        formats: FORMAT_CHECKS,
        regexp_resolver: "ecma",
        ref_resolver: proc { |uri| raise JSONSchemer::UnknownRef, uri.to_s }
      )
    end

    # A schema the gem bundles, by its file name in artifacts/.
    def bundled(name) = compile(JSON.parse(File.read(File.join(ARTIFACTS, name))))

    # Each validation error as its JSON Pointer and message, the pointer placed inside an
    # enclosing document by `prefix`; an error at the document's root is at /. A oneOf whose
    # branches are told apart by a const reports only the branch the value chose.
    def errors(schema, value, prefix = "")
      chosen_branches(schema.validate(value).to_a).map do |error|
        pointer = "#{prefix}#{error.fetch("data_pointer")}"
        "#{pointer.empty? ? "/" : pointer}: #{error.fetch("error")}"
      end
    end

    ONE_OF_BRANCH = %r{\A(.*/oneOf)/(\d+)(?:/|\z)}

    def chosen_branches(errors)
      errors.group_by { |error| error.fetch("schema_pointer")[ONE_OF_BRANCH, 1] }.flat_map do |one_of, group|
        one_of ? one_of_errors(one_of, group) : group
      end
    end

    # A failed oneOf's errors: the chosen branch's, the allowed values when the value chose none,
    # or every branch's when no const tells them apart.
    def one_of_errors(one_of, group)
      branches = group.group_by { |error| error.fetch("schema_pointer")[ONE_OF_BRANCH, 2] }
      refused = branches.transform_values { |branch| discriminator(branch, one_of) }
      chosen = refused.select { |_, error| error.nil? }.keys
      return branches.fetch(chosen.first) if chosen.size == 1 && refused.size > 1
      return group unless chosen.empty?

      not_one_of(refused.values) || group
    end

    def not_one_of(refusals)
      pointers = refusals.map { |error| error.fetch("data_pointer") }.uniq
      return unless pointers.size == 1

      allowed = refusals.map { |error| error.dig("schema", "const").to_json }.join(", ")
      [{ "data_pointer" => pointers.first, "error" => "value at `#{pointers.first}` is not one of: [#{allowed}]" }]
    end

    # The const a oneOf branch refused on a member of the value it was choosing for.
    def discriminator(branch, one_of)
      branch.find do |error|
        error.fetch("type") == "const" && error.fetch("schema_pointer").sub(one_of, "").count("/") == 3
      end
    end

    CORE = bundled("core.schema.json")
    CONTRACT = bundled("contract.schema.json")
    IMPLEMENTATION = bundled("implementation.schema.json")
  end
  private_constant :Schemas
end

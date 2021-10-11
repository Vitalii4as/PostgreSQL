const defaultTypes = require('./configs/defaultTypes');
const types = require('./configs/types');
const templates = require('./configs/templates');

module.exports = (baseProvider, options, app) => {
    const { commentIfDeactivated, checkAllKeysDeactivated, divideIntoActivatedAndDeactivated, hasType, wrap, clean } =
        app.utils.general;
    const assignTemplates = app.utils.assignTemplates;
    const _ = app.require('lodash');
    const { decorateType, decorateDefault } = require('./helpers/columnDefinitionHelper')(_, wrap);
    const { getFunctionArguments, wrapInQuotes, getNamePrefixedWithSchemaName, getColumnsList } =
        require('./helpers/general')({
            _,
            divideIntoActivatedAndDeactivated,
            commentIfDeactivated,
        });
    const { generateConstraintsString, foreignKeysToString, foreignActiveKeysToString, createKeyConstraint } =
        require('./helpers/constraintsHelper')({
            _,
            commentIfDeactivated,
            checkAllKeysDeactivated,
            assignTemplates,
            getColumnsList,
            wrapInQuotes,
        });
    const keyHelper = require('./helpers/keyHelper')(_, clean);

    const { getFunctionsScript } = require('./helpers/functionHelper')({
        _,
        templates,
        assignTemplates,
        getFunctionArguments,
        getNamePrefixedWithSchemaName,
    });

    const { getProceduresScript } = require('./helpers/procedureHelper')({
        _,
        templates,
        assignTemplates,
        getFunctionArguments,
        getNamePrefixedWithSchemaName,
    });

    const { getTableTemporaryValue, getTableOptions } = require('./helpers/tableHelper')({
        _,
        checkAllKeysDeactivated,
        getColumnsList,
    });

    const { getUserDefinedType } = require('./helpers/udtHelper')({
        _,
        commentIfDeactivated,
        assignTemplates,
        templates,
        getNamePrefixedWithSchemaName,
    });

    return {
        createDatabase({ databaseName, ifNotExist, comments, udfs, procedures }) {
            const comment = assignTemplates(templates.comment, {
                object: 'SCHEMA',
                objectName: wrapInQuotes(databaseName),
                comment: comments,
            });

            const schemaStatement = assignTemplates(templates.createSchema, {
                name: wrapInQuotes(databaseName),
                ifNotExist: ifNotExist ? ' IF NOT EXISTS' : '',
                comment: comments ? comment : '',
            });

            const createFunctionStatement = getFunctionsScript(databaseName, udfs);
            const createProceduresStatement = getProceduresScript(databaseName, procedures);

            return _.trim([schemaStatement, createFunctionStatement, createProceduresStatement].join('\n\n'));
        },

        createTable(
            {
                name,
                columns,
                checkConstraints,
                foreignKeyConstraints,
                dbData,
                columnDefinitions,
                relatedSchemas,
                keyConstraints,
                inherits,
                description,
                ifNotExist,
                usingMethod,
                on_commit,
                partitioning,
                storage_parameter,
                table_tablespace_name,
                temporary,
                unlogged,
                selectStatement,
            },
            isActivated
        ) {
            const comment = assignTemplates(templates.comment, {
                object: 'TABLE',
                objectName: getNamePrefixedWithSchemaName(name, dbData.databaseName),
                comment: description,
            });

            const dividedKeysConstraints = divideIntoActivatedAndDeactivated(
                keyConstraints.map(createKeyConstraint(templates, isActivated)),
                key => key.statement
            );
            const keyConstraintsString = generateConstraintsString(dividedKeysConstraints, isActivated);

            const dividedForeignKeys = divideIntoActivatedAndDeactivated(foreignKeyConstraints, key => key.statement);
            const foreignKeyConstraintsString = generateConstraintsString(dividedForeignKeys, isActivated);

            const tableStatement = assignTemplates(templates.createTable, {
                temporary: getTableTemporaryValue(temporary, unlogged),
                ifNotExist,
                name: getNamePrefixedWithSchemaName(name, dbData.databaseName),
                columnDefinitions: '\t' + _.join(columns, ',\n\t'),
                keyConstraints: keyConstraintsString,
                checkConstraints: !_.isEmpty(checkConstraints) ? ',\n\t' + _.join(checkConstraints, ',\n\t') : '',
                foreignKeyConstraints: foreignKeyConstraintsString,
                options: getTableOptions({
                    inherits,
                    partitioning,
                    usingMethod,
                    on_commit,
                    storage_parameter,
                    table_tablespace_name,
                    selectStatement,
                }),
                comment: description ? comment : '',
            });

            return tableStatement;
        },

        convertColumnDefinition(columnDefinition) {
            const notNull = columnDefinition.nullable ? '' : ' NOT NULL';
            const primaryKey = columnDefinition.primaryKey ? ' PRIMARY KEY' : '';
            const uniqueKey = columnDefinition.unique ? ' UNIQUE' : '';
            const collation = columnDefinition.collationRule ? ` COLLATE "${columnDefinition.collationRule}"` : '';
            const defaultValue = !_.isUndefined(columnDefinition.default)
                ? ' DEFAULT ' + decorateDefault(columnDefinition.type, columnDefinition.default)
                : '';

            return commentIfDeactivated(
                assignTemplates(templates.columnDefinition, {
                    name: wrapInQuotes(columnDefinition.name),
                    type: decorateType(columnDefinition.type, columnDefinition),
                    notNull,
                    primaryKey,
                    uniqueKey,
                    collation,
                    defaultValue,
                }),
                {
                    isActivated: columnDefinition.isActivated,
                }
            );
        },

        createIndex(tableName, index, dbData, isParentActivated = true) {
            return '';
        },

        createCheckConstraint(checkConstraint) {
            return assignTemplates(templates.checkConstraint, {
                name: checkConstraint.name ? `CONSTRAINT ${wrapInQuotes(checkConstraint.name)}` : '',
                expression: _.trim(checkConstraint.expression).replace(/^\(([\s\S]*)\)$/, '$1'),
                noInherit: checkConstraint.noInherit ? ' NO INHERIT' : '',
            });
        },

        createForeignKeyConstraint(
            {
                name,
                foreignKey,
                primaryTable,
                primaryKey,
                primaryTableActivated,
                foreignTableActivated,
                foreignSchemaName,
                primarySchemaName,
            },
            dbData
        ) {
            const isAllPrimaryKeysDeactivated = checkAllKeysDeactivated(primaryKey);
            const isAllForeignKeysDeactivated = checkAllKeysDeactivated(foreignKey);
            const isActivated =
                !isAllPrimaryKeysDeactivated &&
                !isAllForeignKeysDeactivated &&
                primaryTableActivated &&
                foreignTableActivated;

            const foreignKeyStatement = assignTemplates(templates.createForeignKeyConstraint, {
                primaryTable: getNamePrefixedWithSchemaName(primaryTable, primarySchemaName || dbData.databaseName),
                name: name ? `CONSTRAINT ${wrapInQuotes(name)}` : '',
                foreignKey: isActivated ? foreignKeysToString(foreignKey) : foreignActiveKeysToString(foreignKey),
                primaryKey: isActivated ? foreignKeysToString(primaryKey) : foreignActiveKeysToString(primaryKey),
            });

            return {
                statement: _.trim(foreignKeyStatement),
                isActivated,
            };
        },

        createForeignKey(
            {
                name,
                foreignTable,
                foreignKey,
                primaryTable,
                primaryKey,
                primaryTableActivated,
                foreignTableActivated,
                foreignSchemaName,
                primarySchemaName,
            },
            dbData
        ) {
            const isAllPrimaryKeysDeactivated = checkAllKeysDeactivated(primaryKey);
            const isAllForeignKeysDeactivated = checkAllKeysDeactivated(foreignKey);
            const isActivated =
                !isAllPrimaryKeysDeactivated &&
                !isAllForeignKeysDeactivated &&
                primaryTableActivated &&
                foreignTableActivated;

            const foreignKeyStatement = assignTemplates(templates.createForeignKey, {
                primaryTable: getNamePrefixedWithSchemaName(primaryTable, primarySchemaName || dbData.databaseName),
                foreignTable: getNamePrefixedWithSchemaName(foreignTable, foreignSchemaName || dbData.databaseName),
                name: name ? wrapInQuotes(name) : '',
                foreignKey: isActivated ? foreignKeysToString(foreignKey) : foreignActiveKeysToString(foreignKey),
                primaryKey: isActivated ? foreignKeysToString(primaryKey) : foreignActiveKeysToString(primaryKey),
            });

            return {
                statement: _.trim(foreignKeyStatement),
                isActivated,
            };
        },

        createView(viewData, dbData, isActivated) {
            return '';
        },

        createViewIndex(viewName, index, dbData, isParentActivated) {
            return '';
        },

        createUdt(udt, dbData) {
            const columns = _.map(udt.properties, this.convertColumnDefinition);

            return getUserDefinedType(udt, columns);
        },

        getDefaultType(type) {
            return defaultTypes[type];
        },

        getTypesDescriptors() {
            return types;
        },

        hasType(type) {
            return hasType(types, type);
        },

        hydrateColumn({ columnDefinition, jsonSchema, dbData }) {
            const collationRule = _.includes(['char', 'varchar', 'text'], columnDefinition.type)
                ? jsonSchema.collationRule
                : '';
            const timeTypes = ['time', 'timestamp'];
            const timePrecision = _.includes(timeTypes, columnDefinition.type) ? jsonSchema.timePrecision : '';
            const with_timezone = _.includes(timeTypes, columnDefinition.type) ? jsonSchema.with_timezone : '';
            const intervalOptions = columnDefinition.type === 'interval' ? jsonSchema.intervalOptions : '';

            return {
                name: columnDefinition.name,
                type: columnDefinition.type,
                primaryKey: keyHelper.isInlinePrimaryKey(jsonSchema),
                unique: keyHelper.isInlineUnique(jsonSchema),
                nullable: columnDefinition.nullable,
                default: columnDefinition.default,
                comment: jsonSchema.description,
                isActivated: columnDefinition.isActivated,
                scale: columnDefinition.scale,
                precision: columnDefinition.precision,
                length: columnDefinition.length,
                enum: jsonSchema.enum,
                array_type: jsonSchema.array_type,
                unit: jsonSchema.unit,
                rangeSubtype: jsonSchema.rangeSubtype,
                operatorClass: jsonSchema.operatorClass,
                collation: jsonSchema.collation,
                canonicalFunction: jsonSchema.canonicalFunction,
                subtypeDiffFunction: jsonSchema.subtypeDiffFunction,
                multiRangeType: jsonSchema.multiRangeType,
                databaseName: dbData.databaseName,
                collationRule,
                timePrecision,
                with_timezone,
                intervalOptions,
            };
        },

        hydrateIndex(indexData, tableData) {
            return indexData;
        },

        hydrateViewIndex(indexData) {
            return {};
        },

        hydrateCheckConstraint(checkConstraint) {
            return {
                name: checkConstraint.chkConstrName,
                expression: checkConstraint.constrExpression,
                noInherit: checkConstraint.noInherit,
            };
        },

        hydrateDatabase(containerData, data) {
            return {
                databaseName: containerData.name,
                ifNotExist: containerData.ifNotExist,
                comments: containerData.description,
                udfs: data?.udfs || [],
                procedures: data?.procedures || [],
            };
        },

        hydrateTable({ tableData, entityData, jsonSchema }) {
            const detailsTab = entityData[0];
            const inheritsTable = _.get(tableData, `relatedSchemas[${detailsTab.inherits}]`, '');
            const partitioning = _.first(detailsTab.partitioning) || {};
            const compositePartitionKey = keyHelper.getKeys(partitioning.compositePartitionKey, jsonSchema);

            return {
                ...tableData,
                keyConstraints: keyHelper.getTableKeyConstraints(jsonSchema),
                inherits: inheritsTable?.code || inheritsTable?.collectionName,
                selectStatement: _.trim(detailsTab.selectStatement),
                partitioning: _.assign({}, partitioning, { compositePartitionKey }),
                ..._.pick(
                    detailsTab,
                    'temporary',
                    'unlogged',
                    'description',
                    'ifNotExist',
                    'usingMethod',
                    'on_commit',
                    'storage_parameter',
                    'table_tablespace_name'
                ),
            };
        },

        hydrateViewColumn(data) {
            return '';
        },

        hydrateView({ viewData, entityData, relatedSchemas, relatedContainers }) {
            return '';
        },

        commentIfDeactivated(statement, data, isPartOfLine) {
            return statement;
        },
    };
};

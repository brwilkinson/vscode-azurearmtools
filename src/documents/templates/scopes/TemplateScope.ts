// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as assert from 'assert';
import { Json, strings } from '../../../../extension.bundle';
import { templateKeys } from '../../../constants';
import * as TLE from "../../../language/expressions/TLE";
import { CachedValue } from '../../../util/CachedValue';
import { IParameterDefinition } from '../../parameters/IParameterDefinition';
import { IParameterDefinitionsSource } from '../../parameters/IParameterDefinitionsSource';
import { IParameterValuesSource } from '../../parameters/IParameterValuesSource';
import { IJsonDocument } from '../IJsonDocument';
import { IResource } from '../IResource';
import { UserFunctionDefinition } from '../UserFunctionDefinition';
import { UserFunctionNamespaceDefinition } from "../UserFunctionNamespaceDefinition";
import { IVariableDefinition } from '../VariableDefinition';

export enum TemplateScopeKind {
    TopLevel = "TopLevel",
    ParameterDefaultValue = "ParameterDefaultValue",
    UserFunction = "UserFunction",
    NestedDeploymentWithInnerScope = "NestedDeploymentWithInnerScope",
    NestedDeploymentWithOuterScope = "NestedDeploymentWithOuterScope",
    LinkedDeployment = "LinkedDeployment",
}

// CONSIDER:
// Right now, deployments are scopes (although nested templates give back the parent's
// params/vars/funcs), but non-deployment scopes exist, too.
// Probably better to have ITemplateDeployment and IScope separate, with ITemplateDeployment
// having a scope.

/**
 * Represents the scoped access of parameters/variables/functions at a particular point in the template tree.
 */
export abstract class TemplateScope implements IParameterDefinitionsSource {
    private _parameterDefinitions: CachedValue<IParameterDefinition[] | undefined> = new CachedValue<IParameterDefinition[] | undefined>();
    private _variableDefinitions: CachedValue<IVariableDefinition[] | undefined> = new CachedValue<IVariableDefinition[] | undefined>();
    private _functionDefinitions: CachedValue<UserFunctionNamespaceDefinition[] | undefined> = new CachedValue<UserFunctionNamespaceDefinition[] | undefined>();
    private _resources: CachedValue<IResource[] | undefined> = new CachedValue<IResource[] | undefined>();
    private _parameterValues: CachedValue<IParameterValuesSource | undefined> = new CachedValue<IParameterValuesSource | undefined>();

    constructor(
        public readonly document: IJsonDocument, // The document that contains this scope
        public readonly rootObject: Json.ObjectValue | undefined,
        // tslint:disable-next-line:variable-name
        public readonly __debugDisplay: string // Provides context for debugging
    ) {
    }

    public readonly abstract scopeKind: TemplateScopeKind;

    // CONSIDER: Better design. Split out resources from params/vars/functions, or separate
    //   concept of deployment from concept of scope?
    /**
     * Indicates whether this scope's params, vars and namespaces are unique.
     * False if it shares its members with its parents.
     * Note that resources are always unique for a scope.
     */
    public readonly hasUniqueParamsVarsAndFunctions: boolean = true;

    // undefined means not supported in this context
    protected getParameterDefinitions(): IParameterDefinition[] | undefined {
        // undefined means not supported in this context
        return undefined;
    }
    protected getVariableDefinitions(): IVariableDefinition[] | undefined {
        // undefined means not supported in this context
        return undefined;
    }
    protected getNamespaceDefinitions(): UserFunctionNamespaceDefinition[] | undefined {
        // undefined means not supported in this context
        return undefined;
    }
    protected getResources(): IResource[] | undefined {
        // undefined means not supported in this context
        return undefined;
    }

    // NOTE: This returns undefined for top-level scopes, since that would need to
    //   come from a parameter file loaded later
    // CONSIDER: Return IParameterValuesSourceProvider instead
    protected getParameterValuesSource(): IParameterValuesSource | undefined {
        return undefined;
    }

    public get parameterDefinitions(): IParameterDefinition[] {
        return this._parameterDefinitions.getOrCacheValue(() => this.getParameterDefinitions())
            ?? [];
    }

    public get variableDefinitions(): IVariableDefinition[] {
        return this._variableDefinitions.getOrCacheValue(() => this.getVariableDefinitions())
            ?? [];
    }

    public get namespaceDefinitions(): UserFunctionNamespaceDefinition[] {
        return this._functionDefinitions.getOrCacheValue(() => this.getNamespaceDefinitions())
            ?? [];
    }

    public get resources(): IResource[] {
        return this._resources.getOrCacheValue(() => this.getResources())
            ?? [];
    }

    public get parameterValuesSource(): IParameterValuesSource | undefined {
        return this._parameterValues.getOrCacheValue(() => this.getParameterValuesSource());
    }

    public get childScopes(): TemplateScope[] {
        const scopes: TemplateScope[] = [];
        for (let resource of this.resources ?? []) {
            if (resource.childDeployment) {
                scopes.push(resource.childDeployment);
            }
        }

        // If it's not unique, we'll end up getting the parent's function definitions
        // instead of our own
        if (this.hasUniqueParamsVarsAndFunctions) {
            for (let namespace of this.namespaceDefinitions) {
                for (let member of namespace.members) {
                    scopes.push(member.scope);
                }
            }
        }

        return scopes;
    }

    // parameterName can be surrounded with single quotes or not.  Search is case-insensitive
    public getParameterDefinition(parameterName: string): IParameterDefinition | undefined {
        assert(parameterName, "parameterName cannot be null, undefined, or empty");

        const unquotedParameterName = strings.unquote(parameterName);
        let parameterNameLC = unquotedParameterName.toLowerCase();

        // Find the last definition that matches, because that's what Azure does if there are matching names
        for (let i = this.parameterDefinitions.length - 1; i >= 0; --i) {
            let pd = this.parameterDefinitions[i];
            if (pd.nameValue.toString().toLowerCase() === parameterNameLC) {
                return pd;
            }
        }
        return undefined;
    }

    // Search is case-insensitive
    public getFunctionNamespaceDefinition(namespaceName: string): UserFunctionNamespaceDefinition | undefined {
        assert(!!namespaceName, "namespaceName cannot be null, undefined, or empty");
        let namespaceNameLC = namespaceName.toLowerCase();
        return this.namespaceDefinitions.find((nd: UserFunctionNamespaceDefinition) => nd.nameValue.toString().toLowerCase() === namespaceNameLC);
    }

    // Search is case-insensitive
    public getUserFunctionDefinition(namespaceName: string, functionName: string): UserFunctionDefinition | undefined {
        assert(!!functionName, "functionName cannot be null, undefined, or empty");
        let nd = this.getFunctionNamespaceDefinition(namespaceName);
        if (nd) {
            let result = nd.getMemberDefinition(functionName);
            return result ? result : undefined;
        }

        return undefined;
    }

    // variableName can be surrounded with single quotes or not.  Search is case-insensitive
    public getVariableDefinition(variableName: string): IVariableDefinition | undefined {
        assert(variableName, "variableName cannot be null, undefined, or empty");

        const unquotedVariableName = strings.unquote(variableName);
        const variableNameLC = unquotedVariableName.toLowerCase();

        // Find the last definition that matches, because that's what Azure does
        for (let i = this.variableDefinitions.length - 1; i >= 0; --i) {
            let vd = this.variableDefinitions[i];
            if (vd.nameValue.toString().toLowerCase() === variableNameLC) {
                return vd;
            }
        }

        return undefined;
    }

    /**
     * If the function call is a variables() reference, return the related variable definition
     */
    public getVariableDefinitionFromFunctionCall(tleFunction: TLE.FunctionCallValue): IVariableDefinition | undefined {
        let result: IVariableDefinition | undefined;

        if (tleFunction.isCallToBuiltinWithName(templateKeys.variables)) {
            const variableName: TLE.StringValue | undefined = TLE.asStringValue(tleFunction.argumentExpressions[0]);
            if (variableName) {
                result = this.getVariableDefinition(variableName.toString());
            }
        }

        return result;
    }

    /**
     * If the function call is a parameters() reference, return the related parameter definition
     */
    public getParameterDefinitionFromFunctionCall(tleFunction: TLE.FunctionCallValue): IParameterDefinition | undefined {
        assert(tleFunction);

        let result: IParameterDefinition | undefined;

        if (tleFunction.isCallToBuiltinWithName(templateKeys.parameters)) {
            const propertyName: TLE.StringValue | undefined = TLE.asStringValue(tleFunction.argumentExpressions[0]);
            if (propertyName) {
                result = this.getParameterDefinition(propertyName.toString());
            }
        }

        return result;
    }

    public get isInUserFunction(): boolean {
        return this.scopeKind === TemplateScopeKind.UserFunction;
    }
}
